"use client";

import { useCallback, useEffect } from "react";

interface Props {
	/** Frame timestamps, oldest first. */
	times: string[];
	index: number;
	/** Takes the previous index so playback can advance without re-arming. */
	onChange: (next: (prev: number) => number) => void;
	playing: boolean;
	onTogglePlay: () => void;
}

/** Milliseconds per frame while playing: a full day in about 10 seconds. */
const FRAME_MS = 420;

export default function TimeSlider({
	times,
	index,
	onChange,
	playing,
	onTogglePlay,
}: Props) {
	const last = times.length - 1;
	const current = times[index];

	// Advancing from the previous index keeps the interval armed once per play,
	// rather than re-arming every frame and drifting.
	useEffect(() => {
		if (!playing || last < 1) return;
		const timer = setInterval(
			() => onChange((prev) => (prev + 1) % (last + 1)),
			FRAME_MS,
		);
		return () => clearInterval(timer);
	}, [playing, last, onChange]);

	const step = useCallback(
		(delta: number) => {
			onChange((prev) => Math.min(last, Math.max(0, prev + delta)));
		},
		[last, onChange],
	);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const el = e.target as HTMLElement | null;
			if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
			if (e.key === "ArrowLeft") step(-1);
			else if (e.key === "ArrowRight") step(1);
			else if (e.key === " ") {
				e.preventDefault();
				onTogglePlay();
			} else return;
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [step, onTogglePlay]);

	if (last < 1) return null;

	const date = new Date(current);
	const atLatest = index === last;

	return (
		<div className="pointer-events-auto absolute bottom-6 left-1/2 z-20 w-[min(38rem,calc(100vw-22rem))] -translate-x-1/2 rounded-lg border border-white/10 bg-[#0d1017]/90 px-4 py-3 backdrop-blur">
			<div className="flex items-center gap-3">
				<button
					type="button"
					onClick={onTogglePlay}
					aria-label={playing ? "Pause" : "Play"}
					className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/15 text-white/80 transition hover:border-white/35 hover:text-white"
				>
					{playing ? (
						<svg viewBox="0 0 10 10" className="h-3 w-3" aria-hidden="true">
							<rect x="1" y="1" width="2.6" height="8" fill="currentColor" />
							<rect x="6.4" y="1" width="2.6" height="8" fill="currentColor" />
						</svg>
					) : (
						<svg viewBox="0 0 10 10" className="h-3 w-3" aria-hidden="true">
							<path d="M2 1 L9 5 L2 9 Z" fill="currentColor" />
						</svg>
					)}
				</button>

				<div className="min-w-0 flex-1">
					<input
						type="range"
						min={0}
						max={last}
						step={1}
						value={index}
						onChange={(e) => {
							const v = Number(e.target.value);
							onChange(() => v);
						}}
						aria-label="Time"
						className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-[#ffd980] outline-none [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#ffd980]"
					/>
					<div className="mt-1.5 flex justify-between text-[10px] text-white/35">
						<span>{hourLabel(times[0])}</span>
						<span>now</span>
					</div>
				</div>

				<div className="w-28 shrink-0 text-right">
					<div className="tabular-nums text-sm text-white/90">
						{hourLabel(current)}
					</div>
					<div className="text-[10px] text-white/35">
						{atLatest
							? "latest"
							: `${date.getUTCDate()} ${date.toLocaleString("en", { month: "short", timeZone: "UTC" })}`}
					</div>
				</div>
			</div>
		</div>
	);
}

function hourLabel(iso: string): string {
	const d = new Date(iso);
	return `${String(d.getUTCHours()).padStart(2, "0")}:00 UTC`;
}
