"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { Mic } from "lucide-react"
import { useAudioRecording } from "@/hooks/use-audio-recording"
import { AudioVisualizer } from "@/components/ui/audio-visualizer"

export interface IntentLineProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  transcribeAudio?: (blob: Blob) => Promise<string>
}

const IntentLine = React.forwardRef<HTMLTextAreaElement, IntentLineProps>(
  ({ className, transcribeAudio, ...props }, ref) => {
    const localRef = React.useRef<HTMLTextAreaElement>(null)
    const setRef = React.useCallback(
      (node: HTMLTextAreaElement) => {
        localRef.current = node
        if (typeof ref === "function") ref(node)
        else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node
      },
      [ref]
    )

    const {
      isListening,
      isSpeechSupported,
      isRecording,
      isTranscribing,
      audioStream,
      toggleListening,
      stopRecording,
    } = useAudioRecording({
      transcribeAudio,
      onTranscriptionComplete: (text) => {
        props.onChange?.({ target: { value: text } } as React.ChangeEvent<HTMLTextAreaElement>)
        // Focus the input after transcription
        localRef.current?.focus()
      },
    })

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        // Call the original onKeyDown if it exists
        props.onKeyDown?.(e)
      } else {
        props.onKeyDown?.(e)
      }
    }

    return (
      <div className="relative w-full">
        <textarea
          className={cn(
            "placeholder:text-step-10 selection:bg-step-11 selection:text-step-1 border-step-12/20 flex h-9 w-full min-w-0 resize-none border px-3 py-1 text-base transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
            "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
            className
          )}
          ref={setRef}
          {...props}
          onKeyDown={handleKeyDown}
          style={{
            maskImage: 'linear-gradient(to right, transparent, black 2%, black 98%, transparent)',
            WebkitMaskImage: 'linear-gradient(to right, transparent, black 2%, black 98%, transparent)',
            ...props.style
          }}
        />
        <button
          type="button"
          aria-label="Voice input"
          onClick={toggleListening}
          onKeyDown={(e) => {
            // Prevent Enter key from triggering voice recording
            if (e.key === 'Enter') {
              e.preventDefault()
              e.stopPropagation()
            }
          }}
          className={cn(
            "absolute right-2 bottom-2.5 z-20",
            "hover:bg-step-4 hover:text-step-12 rounded-full p-1.5 -mb-1.5 -mr-1.5 transition-colors",
            !isRecording && !isListening && "text-step-10",
            isListening && !isRecording && "text-step-11",
            isRecording && "text-birkin hover:bg-transparent hover:text-birkin",
            !isSpeechSupported && "hidden"
          )}
        >
          <Mic className="h-4 w-4" />
        </button>
        {isRecording && (
          <div className="absolute inset-y-[1px] left-[1px] right-[40px] z-10 overflow-hidden rounded">
            <AudioVisualizer
              stream={audioStream}
              isRecording={isRecording}
              onClick={stopRecording}
            />
          </div>
        )}
        {isTranscribing && (
          <div className="absolute inset-[1px] z-10 flex items-center justify-center rounded bg-step-2/80 text-sm text-step-10 backdrop-blur-sm">
            Transcribing...
          </div>
        )}
      </div>
    )
  }
)
IntentLine.displayName = "IntentLine"

export { IntentLine }
