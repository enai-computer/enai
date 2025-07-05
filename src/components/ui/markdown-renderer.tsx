import React, { useState, useEffect, useMemo } from "react"
import Markdown, { Components, ExtraProps } from "react-markdown"
import remarkGfm from "remark-gfm"

import { cn } from "@/lib/utils"
import { CopyButton } from "@/components/ui/copy-button"

interface MarkdownRendererProps {
  children: string
  onLinkClick?: (href: string) => void
}

export function MarkdownRenderer({ children, onLinkClick }: MarkdownRendererProps) {
  const components = useMemo(() => {
    if (!onLinkClick) return COMPONENTS;
    
    return {
      ...COMPONENTS,
      a: ({ children, href, className, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & ExtraProps) => {
        const handleClick = (e: React.MouseEvent) => {
          if (href) {
            e.preventDefault();
            onLinkClick(href);
          }
        };
        
        return (
          <a 
            href={href}
            className={cn("text-step-12 hover:text-birkin underline underline-offset-2 cursor-pointer transition-colors duration-200", className)}
            onClick={handleClick}
            {...props}
          >
            {children}
          </a>
        );
      },
    };
  }, [onLinkClick]);

  return (
    <div className="space-y-3">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </Markdown>
    </div>
  )
}

interface HighlightedPre extends React.HTMLAttributes<HTMLPreElement> {
  children: string
  language: string
}

const HighlightedPre = React.memo(
  ({ children, language, ...props }: HighlightedPre) => {
    const [highlightedCode, setHighlightedCode] = useState<React.ReactNode | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const codeString = children;

    useEffect(() => {
      let isMounted = true
      setIsLoading(true)
      setError(null)
      setHighlightedCode(null)

      const highlight = async () => {
        try {
          const { codeToTokens, bundledLanguages } = await import("shiki")

          if (!(language in bundledLanguages)) {
             console.warn(`[Shiki] Language '${language}' not bundled. Rendering plain text.`);
             if (isMounted) {
               setHighlightedCode(<code>{codeString}</code>);
               setIsLoading(false);
             }
            return;
          }

          const { tokens } = await codeToTokens(codeString, {
            lang: language as keyof typeof bundledLanguages,
            defaultColor: false,
            themes: {
              light: "github-light",
              dark: "github-dark",
            },
          })

          if (isMounted) {
             const codeNode = (
               <code>
                 {tokens.map((line, lineIndex) => (
                   <React.Fragment key={lineIndex}>
                     <span>
                       {line.map((token, tokenIndex) => {
                         const style =
                           typeof token.htmlStyle === "string"
                             ? undefined
                             : token.htmlStyle

                         return (
                           <span
                             key={tokenIndex}
                             className="text-shiki-light bg-shiki-light-bg dark:text-shiki-dark dark:bg-shiki-dark-bg"
                             style={style}
                           >
                             {token.content}
                           </span>
                         )
                       })}
                     </span>
                     {lineIndex !== tokens.length - 1 && "\n"}
                   </React.Fragment>
                 ))}
               </code>
             );
            setHighlightedCode(codeNode)
            setIsLoading(false)
          }
        } catch (err) {
          console.error("[Shiki] Error highlighting code:", err)
          if (isMounted) {
            setError("Failed to highlight code.")
            setHighlightedCode(<code>{codeString}</code>);
            setIsLoading(false)
          }
        }
      }

      highlight()

      return () => {
        isMounted = false
      }
    }, [codeString, language])

    return (
      <pre {...props}>
        {isLoading && <span>Loading syntax highlighting...</span>}
        {error && <span className="text-destructive">{error}</span>}
        {!isLoading && !error && highlightedCode}
        {(isLoading || error) && !highlightedCode && <code>{codeString}</code>}
      </pre>
    )
  }
)
HighlightedPre.displayName = "HighlightedCode"

interface CodeBlockProps extends React.HTMLAttributes<HTMLPreElement> {
  children: React.ReactNode
  className?: string
  language: string
}

const CodeBlock = ({
  children,
  className,
  language,
  ...restProps
}: CodeBlockProps) => {
  const code =
    typeof children === "string"
      ? children
      : childrenTakeAllStringContents(children)

  const preClass = cn(
    "overflow-x-scroll rounded-md border bg-step-1/50 p-4 font-mono text-sm [scrollbar-width:none]",
    className
  )

  return (
    <div className="group/code relative mb-4">
       <HighlightedPre language={language} className={preClass} {...restProps}>
         {code}
       </HighlightedPre>

      <div className="invisible absolute right-2 top-2 flex space-x-1 rounded-lg p-1 opacity-0 transition-all duration-200 group-hover/code:visible group-hover/code:opacity-100">
        <CopyButton content={code} copyMessage="Copied code to clipboard" />
      </div>
    </div>
  )
}

function childrenTakeAllStringContents(element: React.ReactNode): string {
  if (typeof element === "string") {
    return element
  }

  if (React.isValidElement(element)) {
    const children = (element.props as { children?: React.ReactNode }).children
    if (!children) return ""

    if (Array.isArray(children)) {
      return children
        .map((child) => childrenTakeAllStringContents(child))
        .join("")
    } else {
      return childrenTakeAllStringContents(children)
    }
  }

  return ""
}

const COMPONENTS: Partial<Components> = {
  h1: withClass("h1", "text-2xl font-semibold"),
  h2: withClass("h2", "font-semibold text-xl"),
  h3: withClass("h3", "font-semibold text-lg"),
  h4: withClass("h4", "font-semibold text-base"),
  h5: withClass("h5", "font-medium"),
  strong: withClass("strong", "font-bold"),
  em: withClass("em", "font-signifier-light-italic not-italic"),
  a: withClass("a", "text-step-12 hover:text-birkin underline underline-offset-2 transition-colors duration-200"),
  blockquote: withClass("blockquote", "border-l-2 border-step-11 pl-4"),
  code: ({ children, className, ...rest }: React.HTMLAttributes<HTMLElement> & ExtraProps) => {
    const match = /language-(\w+)/.exec(className || "")
    return match ? (
      <CodeBlock className={className} language={match[1]} {...rest}>
        {children}
      </CodeBlock>
    ) : (
      <code
        className={cn(
          "font-mono [:not(pre)>&]:rounded-md [:not(pre)>&]:bg-step-1/50 [:not(pre)>&]:px-1 [:not(pre)>&]:py-0.5"
        )}
        {...rest}
      >
        {children}
      </code>
    )
  },
  pre: ({ children }: React.HTMLAttributes<HTMLPreElement> & ExtraProps) => children,
  ol: withClass("ol", "list-decimal space-y-2 pl-6"),
  ul: withClass("ul", "list-disc space-y-2 pl-6"),
  li: withClass("li", "my-1.5"),
  table: withClass(
    "table",
    "w-full border-collapse overflow-y-auto rounded-md border border-step-12/20"
  ),
  th: withClass(
    "th",
    "border border-step-12/20 px-4 py-2 text-left font-bold [&[align=center]]:text-center [&[align=right]]:text-right"
  ),
  td: withClass(
    "td",
    "border border-step-12/20 px-4 py-2 text-left [&[align=center]]:text-center [&[align=right]]:text-right"
  ),
  tr: withClass("tr", "m-0 border-t p-0 even:bg-step-2"),
  p: withClass("p", "whitespace-pre-wrap"),
  hr: withClass("hr", "border-step-12/20"),
}

function withClass<T extends keyof React.JSX.IntrinsicElements>(Tag: T, classes: string) {
  const Component = (props: React.JSX.IntrinsicElements[T] & ExtraProps) => (
    React.createElement(Tag, { className: classes, ...props })
  )
  Component.displayName = String(Tag)
  return Component
}

export default MarkdownRenderer
