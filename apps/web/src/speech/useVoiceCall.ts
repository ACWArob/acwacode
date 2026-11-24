import type { VoiceInputState } from "@t3tools/client-runtime/voice-input";
import { useEffect, useRef, useState } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import {
  type CallMessage,
  type SilenceTracker,
  type VoiceCallPhase,
  type VoiceProfile,
  repliesToSpeak,
  speakableText,
  startSilenceTracker,
  trackSilence,
  voiceProfileFor,
} from "./voiceCall.logic";

const LEVEL_SAMPLE_MS = 100;
// A send the composer refused never starts a run; listen again instead of waiting forever.
const NO_RUN_TIMEOUT_MS = 15_000;
const NEXT_AGENT_GRACE_MS = 1500;

interface VoiceCallSpeech {
  readonly available: boolean;
  readonly state: VoiceInputState;
  readonly level: number;
  readonly start: () => Promise<void>;
  readonly cancel: () => void;
  readonly submitAfterDictation: (submit: (text: string) => void) => void;
}

function pickVoice(
  voices: ReadonlyArray<SpeechSynthesisVoice>,
  profile: VoiceProfile,
): SpeechSynthesisVoice | null {
  const english = voices.filter((voice) => voice.lang.toLowerCase().startsWith("en"));
  const sameLang = english.filter(
    (voice) => voice.lang.replace("_", "-").toLowerCase() === profile.lang.toLowerCase(),
  );
  return (
    sameLang.find((voice) => profile.nameHints.test(voice.name)) ??
    english.find((voice) => profile.nameHints.test(voice.name)) ??
    sameLang[0] ??
    english[0] ??
    null
  );
}

/** Chrome stops long utterances partway, so speak sentence by sentence. */
function speak(
  text: string,
  profile: VoiceProfile,
  events: { readonly onStart: () => void; readonly onDone: () => void },
): () => void {
  const synth = typeof window === "undefined" ? undefined : window.speechSynthesis;
  if (!synth) {
    events.onStart();
    events.onDone();
    return () => {};
  }
  synth.cancel();
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  const voice = pickVoice(synth.getVoices(), profile);
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    events.onDone();
  };
  sentences.forEach((sentence, index) => {
    const utterance = new SpeechSynthesisUtterance(sentence.trim());
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang ?? profile.lang;
    utterance.pitch = profile.pitch;
    utterance.rate = profile.rate;
    if (index === 0) utterance.onstart = events.onStart;
    if (index === sentences.length - 1) utterance.onend = finish;
    utterance.onerror = () => {
      synth.cancel();
      if (index === 0) events.onStart();
      finish();
    };
    synth.speak(utterance);
  });
  return () => {
    finished = true;
    synth.cancel();
  };
}

export function useVoiceCall(input: {
  readonly speech: VoiceCallSpeech;
  readonly running: boolean;
  readonly messages: ReadonlyArray<CallMessage>;
  /** Provider instance and model that wrote a reply, for picking its voice. */
  readonly speakerOf: (message: CallMessage) => string;
  /** Resets the draft around the cursor: optional mentions before it, the voice hint after it. */
  readonly prepareDraft: (council: boolean) => void;
  readonly submit: () => void;
}) {
  const [phase, setPhase] = useState<VoiceCallPhase>("off");
  const [council, setCouncil] = useState(false);
  const [talking, setTalking] = useState(false);
  const [speaker, setSpeaker] = useState<string | null>(null);
  const [seenIds, setSeenIds] = useState<ReadonlySet<string>>(() => new Set());
  const latest = useRef(input);
  const tracker = useRef<SilenceTracker | null>(null);
  const stopSpeaking = useRef<(() => void) | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- interval and speech callbacks read the latest props
  useEffect(() => {
    latest.current = input;
  });

  const beginTurn = useStableCallback((withCouncil: boolean) => {
    latest.current.prepareDraft(withCouncil);
    tracker.current = startSilenceTracker(Date.now());
    setPhase("listening");
    void latest.current.speech.start();
  });
  const listen = useStableCallback(() => beginTurn(council));

  // Silence detection ends a turn on its own; the caller can also end it right away.
  const finishTurn = useStableCallback(() => {
    if (phase !== "listening") return;
    tracker.current = null;
    setSeenIds(new Set(latest.current.messages.map((message) => message.id)));
    setPhase("sending");
    latest.current.speech.submitAfterDictation(() => {
      latest.current.submit();
      setPhase("waiting");
    });
  });

  const startCall = useStableCallback((withCouncil: boolean) => {
    if (!latest.current.speech.available || phase !== "off") return;
    setCouncil(withCouncil);
    setSeenIds(new Set(latest.current.messages.map((message) => message.id)));
    beginTurn(withCouncil);
  });

  const endCall = useStableCallback(() => {
    stopSpeaking.current?.();
    stopSpeaking.current = null;
    tracker.current = null;
    latest.current.speech.cancel();
    setTalking(false);
    setSpeaker(null);
    setPhase("off");
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- samples the live microphone level to detect the end of the caller's turn
  useEffect(() => {
    if (phase !== "listening") return;
    const timer = window.setInterval(() => {
      const current = tracker.current;
      if (!current || latest.current.speech.state.phase !== "recording") return;
      const next = trackSilence(current, latest.current.speech.level, Date.now());
      tracker.current = next.tracker;
      if (next.done) finishTurn();
    }, LEVEL_SAMPLE_MS);
    return () => window.clearInterval(timer);
  }, [phase, finishTurn]);

  const next =
    phase === "waiting" || phase === "speaking"
      ? (repliesToSpeak(input.messages, seenIds)[0] ?? null)
      : null;
  const doneTalking = phase === "speaking" && !talking && next === null && !input.running;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- plays each finished reply through its agent's voice, one at a time
  useEffect(() => {
    if (!next || talking || stopSpeaking.current) return;
    const id = next.id;
    const who = latest.current.speakerOf(next);
    stopSpeaking.current = speak(speakableText(next.text), voiceProfileFor(who), {
      onStart: () => {
        setSeenIds((seen) => new Set([...seen, id]));
        setPhase("speaking");
        setTalking(true);
        setSpeaker(who);
      },
      onDone: () => {
        stopSpeaking.current = null;
        setTalking(false);
        setSpeaker(null);
      },
    });
  }, [next, talking]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands the turn back to the caller once every agent has spoken
  useEffect(() => {
    if (!doneTalking) return;
    // Queued council runs start a moment after the previous one ends; give them that moment.
    const timer = window.setTimeout(listen, NEXT_AGENT_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [doneTalking, listen]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- recovers when a send never started a run
  useEffect(() => {
    if (phase !== "waiting" || input.running) return;
    const timer = window.setTimeout(listen, NO_RUN_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [phase, input.running, listen]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- stops audio when the composer unmounts mid-call
  useEffect(() => () => stopSpeaking.current?.(), []);

  return { phase, council, speaker, startCall, endCall, finishTurn };
}
