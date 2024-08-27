// page.tsx

"use client";

import clsx from "clsx";
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { EnterIcon, LoadingIcon } from "@/lib/icons";
import { usePlayer } from "@/lib/usePlayer";
import { track } from "@vercel/analytics";
import { useMicVAD, utils } from "@ricky0123/vad-react";

type Message = {
    role: "user" | "assistant";
    content: string;
    latency?: number;
};

export default function Home() {
    const [input, setInput] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const player = usePlayer();

    // State for research results
    const [researchResults, setResearchResults] = useState<string[]>([]);

    const vad = useMicVAD({
        startOnLoad: true,
        onSpeechEnd: (audio) => {
            player.stop();
            const wav = utils.encodeWAV(audio);
            const blob = new Blob([wav], { type: "audio/wav" });
            submit(blob);
            const isFirefox = navigator.userAgent.includes("Firefox");
            if (isFirefox) vad.pause();
        },
        workletURL: "/vad.worklet.bundle.min.js",
        modelURL: "/silero_vad.onnx",
        positiveSpeechThreshold: 0.6,
        minSpeechFrames: 4,
        ortConfig(ort) {
            const isSafari = /^((?!chrome|android).)*safari/i.test(
                navigator.userAgent
            );

            ort.env.wasm = {
                wasmPaths: {
                    "ort-wasm-simd-threaded.wasm":
                        "/ort-wasm-simd-threaded.wasm",
                    "ort-wasm-simd.wasm": "/ort-wasm-simd.wasm",
                    "ort-wasm.wasm": "/ort-wasm.wasm",
                    "ort-wasm-threaded.wasm": "/ort-wasm-threaded.wasm",
                },
                numThreads: isSafari ? 1 : 4,
            };
        },
    });

    useEffect(() => {
        function keyDown(e: KeyboardEvent) {
            if (e.key === "Enter") return inputRef.current?.focus();
            if (e.key === "Escape") return setInput("");
        }

        window.addEventListener("keydown", keyDown);
        return () => window.removeEventListener("keydown", keyDown);
    });

    const [messages, submit, isPending] = useActionState<
        Array<Message>,
        string | Blob
    >(async (prevMessages: any, data: string | Blob) => {
        const formData = new FormData();

        if (typeof data === "string") {
            formData.append("input", data);
            track("Text input");
        } else {
            formData.append("input", data, "audio.wav");
            track("Speech input");
        }

        for (const message of prevMessages) {
            formData.append("message", JSON.stringify(message));
        }

        const submittedAt = Date.now();

        const response = await fetch("/api", {
            method: "POST",
            body: formData,
        });

        const transcript = decodeURIComponent(
            response.headers.get("X-Transcript") || ""
        );
        const text = decodeURIComponent(
            response.headers.get("X-Response") || ""
        );

        if (!response.ok || !transcript || !text || !response.body) {
            if (response.status === 429) {
                toast.error("Too many requests. Please try again later.");
            } else {
                toast.error((await response.text()) || "An error occurred.");
            }

            return prevMessages;
        }

        const latency = Date.now() - submittedAt;
        player.play(response.body, () => {
            const isFirefox = navigator.userAgent.includes("Firefox");
            if (isFirefox) vad.start();
        });
        setInput(transcript);

        // --- Send the transcribed text to the Flask API ---
        const researchResponse = await fetch('/research', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ query: transcript })
        });

        // --- Update the researchResults state with the API response ---
        if (researchResponse.ok) {
            const data = await researchResponse.json();
            setResearchResults(data.answers);
        } else {
            console.error('Error fetching research results:', researchResponse.statusText);
        }

        return [
            ...prevMessages,
            {
                role: "user",
                content: transcript,
            },
            {
                role: "assistant",
                content: text,
                latency,
            },
        ];
    }, []);

    function handleFormSubmit(e: React.FormEvent) {
        e.preventDefault();
        submit(input);
    }

    return (
        <>
            <div className="pb-4 min-h-28" />

            <form
                className="rounded-full bg-neutral-200/80 dark:bg-neutral-800/80 flex items-center w-full max-w-3xl border border-transparent hover:border-neutral-300 focus-within:border-neutral-400 hover:focus-within:border-neutral-400 dark:hover:border-neutral-700 dark:focus-within:border-neutral-600 dark:hover:focus-within:border-neutral-600"
                onSubmit={handleFormSubmit}
            >
                <input
                    type="text"
                    className="bg-transparent focus:outline-none p-4 w-full placeholder:text-neutral-600 dark:placeholder:text-neutral-400"
                    required
                    placeholder="Ask me anything"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    ref={inputRef}
                />

                <button
                    type="submit"
                    className="p-4 text-neutral-700 hover:text-black dark:text-neutral-300 dark:hover:text-white"
                    disabled={isPending}
                    aria-label="Submit"
                >
                    {isPending ? <LoadingIcon /> : <EnterIcon />}
                </button>
            </form>

            <div className="text-neutral-400 dark:text-neutral-600 pt-4 text-center max-w-xl text-balance min-h-28 space-y-4">
                {/* ... Existing UI elements ... */}

                {/* --- Display the research results --- */}
                <div>
                    <h2>Research Results:</h2>
                    <ul>
                        {researchResults.map((result, index) => (
                            <li key={index}>{result}</li>
                        ))}
                    </ul>
                </div>
            </div>

            {/* ... Existing UI elements ... */}
        </>
    );
}

function A(props: any) {
    return (
        <a
            {...props}
            className="text-neutral-500 dark:text-neutral-500 hover:underline font-medium"
        />
    );
}