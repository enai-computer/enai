"use client"

import React, { useMemo, useState } from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { motion } from "framer-motion"
import { Ban, ChevronRight, Code2, Loader2, Terminal } from "lucide-react"

import { cn } from "@/lib/utils"
import { signifier } from "@/lib/fonts"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { FilePreview } from "@/components/ui/file-preview"
import { MarkdownRenderer } from "@/components/ui/markdown-renderer"
import { SliceDetail, ContextState, DisplaySlice } from "../../../shared/types"
import { SliceContext } from "./slice-context"

// Helper function to convert SliceDetail to DisplaySlice
function mapSliceDetailsToDisplaySlices(sliceDetails: SliceDetail[]): DisplaySlice[] {
  return sliceDetails.map(detail => ({
    id: detail.chunkId.toString(),
    title: detail.sourceObjectTitle,
    sourceUri: detail.sourceObjectUri,
    content: detail.content,
    summary: detail.summary,
    sourceType: 'local' as const,
    chunkId: detail.chunkId,
    sourceObjectId: detail.sourceObjectId,
  }));
}

// Helper function to convert ContextState<SliceDetail[]> to ContextState<DisplaySlice[]>
function mapContextState(contextState?: ContextState<SliceDetail[]>): ContextState<DisplaySlice[]> | undefined {
  if (!contextState) return undefined;
  
  if (contextState.data) {
    return {
      status: contextState.status,
      data: mapSliceDetailsToDisplaySlices(contextState.data)
    };
  }
  
  return {
    status: contextState.status,
    data: null
  };
}

const chatBubbleVariants = cva(
  "group/message relative break-words rounded-lg p-3 text-base font-soehne",
  {
    variants: {
      isUser: {
        true: "text-step-11.5 text-lg sm:max-w-[70%]",
        false: "bg-step-2 text-step-12",
      },
      animation: {
        none: "",
        slide: "duration-300 animate-in fade-in-0",
        scale: "duration-300 animate-in fade-in-0 zoom-in-75",
        fade: "duration-500 animate-in fade-in-0",
        "fade-slow": "duration-1500 animate-in fade-in-0",
      },
    },
    compoundVariants: [
      {
        isUser: true,
        animation: "slide",
        class: "slide-in-from-right",
      },
      {
        isUser: false,
        animation: "slide",
        class: "slide-in-from-left",
      },
      {
        isUser: true,
        animation: "scale",
        class: "origin-bottom-right",
      },
      {
        isUser: false,
        animation: "scale",
        class: "origin-bottom-left",
      },
    ],
  }
)

type Animation = VariantProps<typeof chatBubbleVariants>["animation"]

interface Attachment {
  name?: string
  contentType?: string
  url: string
}

interface PartialToolCall {
  state: "partial-call"
  toolName: string
}

interface ToolCall {
  state: "call"
  toolName: string
}

interface ToolResult {
  state: "result"
  toolName: string
  result: {
    __cancelled?: boolean
    [key: string]: unknown
  }
}

type ToolInvocation = PartialToolCall | ToolCall | ToolResult

interface ReasoningPart {
  type: "reasoning"
  reasoning: string
}

interface ToolInvocationPart {
  type: "tool-invocation"
  toolInvocation: ToolInvocation
}

interface TextPart {
  type: "text"
  text: string
}

// For compatibility with AI SDK types, not used
interface SourcePart {
  type: "source"
}

type MessagePart = TextPart | ReasoningPart | ToolInvocationPart | SourcePart

export interface Message {
  id: string
  role: "user" | "assistant" | (string & {})
  content: string
  createdAt?: Date
  experimental_attachments?: Attachment[]
  toolInvocations?: ToolInvocation[]
  parts?: MessagePart[]
  contextState?: ContextState
}

export interface ChatMessageProps extends Message {
  showTimeStamp?: boolean
  animation?: Animation
  actions?: React.ReactNode
  onLinkClick?: (href: string) => void
  className?: string
}

export const ChatMessage: React.FC<ChatMessageProps> = ({
  id,
  role,
  content,
  createdAt,
  showTimeStamp = true,
  animation = "scale",
  actions,
  experimental_attachments,
  toolInvocations,
  parts,
  contextState,
  onLinkClick,
  className,
}) => {
  const files = useMemo(() => {
    return experimental_attachments?.map((attachment) => {
      const dataArray = dataUrlToUint8Array(attachment.url)
      const file = new File([dataArray], attachment.name ?? "Unknown")
      return file
    })
  }, [experimental_attachments])

  const isUser = role === "user"

  const formattedTime = createdAt?.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  })

  if (isUser) {
    return (
      <div
        className={cn("flex flex-col", "items-end", "mt-4", className)}
      >
        {files ? (
          <div className="mb-1 flex flex-wrap gap-2">
            {files.map((file, index) => {
              return <FilePreview file={file} key={`${id}-file-${index}`} />
            })}
          </div>
        ) : null}

        {/* Main content with solid background */}
        <div className={cn(chatBubbleVariants({ isUser: true, animation }), signifier.className, "relative")}>
          <MarkdownRenderer>{content}</MarkdownRenderer>
        </div>

        {showTimeStamp && createdAt ? (
          <time
            dateTime={createdAt.toISOString()}
            className={cn(
              "mt-1 block px-1 text-xs opacity-50",
              animation !== "none" && "duration-500 animate-in fade-in-0"
            )}
          >
            {formattedTime}
          </time>
        ) : null}
      </div>
    )
  }

  if (parts && parts.length > 0) {
    return (
      <React.Fragment>
        {parts.map((part, index) => {
          const uniquePartKey = `${id}-part-${part.type}-${index}`

          if (part.type === "text") {
            return (
              <div
                className={cn("flex flex-col items-start w-full", className)}
                key={uniquePartKey}
              >
                <div className={cn(chatBubbleVariants({ isUser: false, animation }))}>
                  <MarkdownRenderer onLinkClick={onLinkClick}>{part.text}</MarkdownRenderer>
                  {actions ? (
                    <div className="absolute -bottom-4 right-2 flex space-x-1 rounded-lg border bg-step-1 p-1 text-step-12 opacity-0 transition-opacity group-hover/message:opacity-100">
                      {actions}
                    </div>
                  ) : null}
                </div>
              </div>
            )
          } else if (part.type === "reasoning") {
            return <ReasoningBlock key={uniquePartKey} part={part} />
          } else if (part.type === "tool-invocation") {
            return (
              <ToolCall
                key={uniquePartKey}
                toolInvocations={[part.toolInvocation]}
              />
            )
          }
          return null
        })}
        <div className={cn("flex flex-col items-start w-full", className)}>
          {showTimeStamp && createdAt ? (
            <time
              dateTime={createdAt.toISOString()}
              className={cn(
                "mt-1 block px-1 text-xs opacity-50",
                animation !== "none" && "duration-500 animate-in fade-in-0"
              )}
            >
              {formattedTime}
            </time>
          ) : null}
          <SliceContext contextState={mapContextState(contextState)} />
        </div>
      </React.Fragment>
    )
  }

  if (toolInvocations && toolInvocations.length > 0) {
    return (
      <div className={cn("flex flex-col", "items-start", className)}>
        <ToolCall toolInvocations={toolInvocations} />
        {showTimeStamp && createdAt ? (
          <time
            dateTime={createdAt.toISOString()}
            className={cn(
              "mt-1 block px-1 text-xs opacity-50",
              animation !== "none" && "duration-500 animate-in fade-in-0"
            )}
          >
            {formattedTime}
          </time>
        ) : null}
        <SliceContext contextState={mapContextState(contextState)} />
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col", "items-start", className)}>
      <div className={cn(chatBubbleVariants({ isUser: false, animation }))}>
        <MarkdownRenderer onLinkClick={onLinkClick}>{content}</MarkdownRenderer>
        {actions ? (
          <div className="absolute -bottom-4 right-2 flex space-x-1 rounded-lg border bg-step-1 p-1 text-step-12 opacity-0 transition-opacity group-hover/message:opacity-100">
            {actions}
          </div>
        ) : null}
      </div>
      {showTimeStamp && createdAt ? (
        <time
          dateTime={createdAt.toISOString()}
          className={cn(
            "mt-1 block px-1 text-xs opacity-50",
            animation !== "none" && "duration-500 animate-in fade-in-0"
          )}
        >
          {formattedTime}
        </time>
      ) : null}
      <SliceContext contextState={mapContextState(contextState)} />
    </div>
  )
}

function dataUrlToUint8Array(data: string) {
  const base64 = data.split(",")[1]
  const buf = Buffer.from(base64, "base64")
  return new Uint8Array(buf)
}

const ReasoningBlock = ({ part }: { part: ReasoningPart }) => {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="mb-2 flex flex-col items-start sm:max-w-[70%]">
      <Collapsible
        open={isOpen}
        onOpenChange={setIsOpen}
        className="group w-full overflow-hidden rounded-lg border bg-step-2/50"
      >
        <div className="flex items-center p-2">
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-2 text-sm text-step-10 hover:text-step-12">
              <ChevronRight className="h-4 w-4 transition-transform group-data-[state=open]:rotate-90" />
              <span>Thinking</span>
            </button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent forceMount>
          <motion.div
            initial={false}
            animate={isOpen ? "open" : "closed"}
            variants={{
              open: { height: "auto", opacity: 1 },
              closed: { height: 0, opacity: 0 },
            }}
            transition={{ duration: 0.3, ease: [0.04, 0.62, 0.23, 0.98] }}
            className="border-t"
          >
            <div className="p-2">
              <div className="whitespace-pre-wrap text-xs">
                {part.reasoning}
              </div>
            </div>
          </motion.div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

function ToolCall({
  toolInvocations,
}: Pick<ChatMessageProps, "toolInvocations">) {
  if (!toolInvocations?.length) return null

  return (
    <div className="flex flex-col items-start gap-2">
      {toolInvocations.map((invocation, index) => {
        const isCancelled =
          invocation.state === "result" &&
          invocation.result.__cancelled === true

        if (isCancelled) {
          return (
            <div
              key={index}
              className="flex items-center gap-2 rounded-lg border bg-step-2/50 px-3 py-2 text-sm text-step-10"
            >
              <Ban className="h-4 w-4" />
              <span>
                Cancelled{" "}
                <span className="font-mono">
                  {"`"}
                  {invocation.toolName}
                  {"`"}
                </span>
              </span>
            </div>
          )
        }

        switch (invocation.state) {
          case "partial-call":
          case "call":
            return (
              <div
                key={index}
                className="flex items-center gap-2 rounded-lg border bg-step-2/50 px-3 py-2 text-sm text-step-10"
              >
                <Terminal className="h-4 w-4" />
                <span>
                  Calling{" "}
                  <span className="font-mono">
                    {"`"}
                    {invocation.toolName}
                    {"`"}
                  </span>
                  ...
                </span>
                <Loader2 className="h-3 w-3 animate-spin" />
              </div>
            )
          case "result":
            return (
              <div
                key={index}
                className="flex flex-col gap-1.5 rounded-lg border bg-step-2/50 px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2 text-step-10">
                  <Code2 className="h-4 w-4" />
                  <span>
                    Result from{" "}
                    <span className="font-mono">
                      {"`"}
                      {invocation.toolName}
                      {"`"}
                    </span>
                  </span>
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap text-step-12">
                  {JSON.stringify(invocation.result, null, 2)}
                </pre>
              </div>
            )
          default:
            return null
        }
      })}
    </div>
  )
}
