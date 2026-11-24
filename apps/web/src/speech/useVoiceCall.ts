import type { VoiceInputState } from "@t3tools/client-runtime/voice-input";
import { useEffect, useRef, useState } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { openLevelMonitor } from "./levelMonitor";
import {
  type BargeInTracker,
  type CallMessage,
  type SilenceTracker,
  type SpokenProgress,
  type VoiceCallPhase,
  type VoiceProfile,
  callAgentKey,
  nextSpeechChunk,
  readTalkToCutIn,
  skipAllReplies,
  startBargeIn,
  startSilenceTracker,
  trackBargeIn,
  trackSilence,
  voiceProfileFor,
  writeTalkToCutIn,
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
  /** Stops the agent that is answering, when the caller cuts it off. */
  readonly interrupt: () => void;
}) {
  const [phase, setPhase] = useState<VoiceCallPhase>("off");
  const [council, setCouncil] = useState(false);
  const [talking, setTalking] = useState(false);
  const [speaker, setSpeaker] = useState<string | null>(null);
  const [spoken, setSpoken] = useState<SpokenProgress>(() => new Map());
  const [talkToCutIn, setTalkToCutInState] = useState(readTalkToCutIn);
  const latest = useRef(input);
  const tracker = useRef<SilenceTracker | null>(null);
  const bargeIn = useRef<BargeInTracker>(startBargeIn());
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
    setSpoken((current) => skipAllReplies(latest.current.messages, current));
    setPhase("sending");
    latest.current.speech.submitAfterDictation(() => {
      latest.current.submit();
      setPhase("waiting");
    });
  });

  const stopVoice = () => {
    stopSpeaking.current?.();
    stopSpeaking.current = null;
    setTalking(false);
    setSpeaker(null);
  };

  const startCall = useStableCallback((withCouncil: boolean) => {
    if (!latest.current.speech.available || phase !== "off") return;
    setCouncil(withCouncil);
    setSpoken(skipAllReplies(latest.current.messages, new Map()));
    beginTurn(withCouncil);
  });

  const endCall = useStableCallback(() => {
    stopVoice();
    tracker.current = null;
    latest.current.speech.cancel();
    setPhase("off");
  });

  // Like a real call: talking over the agent stops it and gives the caller the floor. In a team
  // call the others keep working in the chat; only the spoken summary stops.
  const cutIn = useStableCallback(() => {
    if (phase !== "waiting" && phase !== "speaking") return;
    stopVoice();
    setSpoken((current) => skipAllReplies(latest.current.messages, current));
    if (!council && latest.current.running) latest.current.interrupt();
    beginTurn(council);
  });

  const setTalkToCutIn = useStableCallback((enabled: boolean) => {
    writeTalkToCutIn(enabled);
    setTalkToCutInState(enabled);
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

  const agentTurn = phase === "waiting" || phase === "speaking";
  const monitorBargeIn = agentTurn && talkToCutIn;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps a mic open while agents answer so the caller can talk over them
  useEffect(() => {
    if (!monitorBargeIn) return;
    let closed = false;
    let close = () => {};
    let timer: number | undefined;
    bargeIn.current = startBargeIn();
    void openLevelMonitor().then(
      (monitor) => {
        if (closed) return monitor.close();
        close = monitor.close;
        timer = window.setInterval(() => {
          const next = trackBargeIn(bargeIn.current, monitor.level());
          bargeIn.current = next.tracker;
          if (next.bargeIn) cutIn();
        }, LEVEL_SAMPLE_MS);
      },
      () => {},
    );
    return () => {
      closed = true;
      window.clearInterval(timer);
      close();
    };
  }, [monitorBargeIn, cutIn]);

  const shouldSpeak = (message: CallMessage) =>
    // In a team call the others talk in the chat; Claude, the lead, speaks the plan.
    !council || callAgentKey(input.speakerOf(message) || null) === "claude";
  const chunk = agentTurn ? nextSpeechChunk(input.messages, spoken, shouldSpeak) : null;
  // A reply with nothing to say aloud (only Markdown) still counts as the agent having answered.
  const replied = input.messages.some(
    (message) => message.role === "assistant" && spoken.get(message.id) !== Infinity,
  );
  const doneTalking =
    agentTurn && (phase === "speaking" || replied) && !talking && chunk === null && !input.running;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads each reply aloud sentence by sentence as the agent writes it
  useEffect(() => {
    if (!chunk || talking || stopSpeaking.current) return;
    const { messageId, end, text } = chunk;
    const message = latest.current.messages.find((candidate) => candidate.id === messageId);
    const who = message ? latest.current.speakerOf(message) : "";
    stopSpeaking.current = speak(text, voiceProfileFor(who), {
      onStart: () => {
        setSpoken((current) => new Map(current).set(messageId, end));
        // The agent's own voice changes what the mic hears; learn the room again.
        bargeIn.current = startBargeIn();
        setPhase("speaking");
        setTalking(true);
        setSpeaker(who);
      },
      onDone: () => {
        stopSpeaking.current = null;
        bargeIn.current = startBargeIn();
        setTalking(false);
        setSpeaker(null);
      },
    });
  }, [chunk, talking]);

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

  return {
    phase,
    council,
    speaker,
    talkToCutIn,
    startCall,
    endCall,
    finishTurn,
    cutIn,
    setTalkToCutIn,
  };
}
