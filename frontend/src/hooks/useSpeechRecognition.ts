import { useEffect, useRef, useState } from "react";

// Thin wrapper over the browser Web Speech API (Chrome/Edge/Safari).
// Supports Indian English ("en-IN") and Hindi ("hi-IN"); Hinglish is best
// captured with hi-IN. Returns interim + final transcript via onTranscript.

type SR = any;

function getSpeechRecognition(): SR | null {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

export function useSpeechRecognition(
  lang: string,
  onTranscript: (text: string) => void
) {
  const [supported] = useState(() => getSpeechRecognition() !== null);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SR | null>(null);
  const cbRef = useRef(onTranscript);
  cbRef.current = onTranscript;

  const stop = () => {
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    setListening(false);
  };

  const start = () => {
    const SRClass = getSpeechRecognition();
    if (!SRClass || listening) return;
    const rec: SR = new SRClass();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    let finalText = "";
    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += chunk;
        else interim += chunk;
      }
      cbRef.current((finalText + interim).trim());
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);

    recRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  };

  useEffect(() => {
    return () => {
      try {
        recRef.current?.abort?.();
      } catch {
        /* ignore */
      }
    };
  }, []);

  return { supported, listening, start, stop };
}
