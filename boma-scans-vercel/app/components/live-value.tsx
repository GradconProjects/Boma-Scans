"use client";
import { useEffect, useRef, useState } from "react";

export function LiveValue({value, label, className = ""}: {value: number; label: string; className?: string}) {
  const previous = useRef(value);
  const [tone, setTone] = useState("");
  useEffect(() => {
    const direction = value > previous.current ? "price-up" : value < previous.current ? "price-down" : "";
    previous.current = value;
    if (!direction) return;
    const start = window.setTimeout(() => setTone(direction), 0);
    const finish = window.setTimeout(() => setTone(""), 700);
    return () => { window.clearTimeout(start); window.clearTimeout(finish); };
  }, [value]);
  return <span className={"inline-block tabular-nums " + className + " " + tone}>{label}</span>;
}
