import {
  Tools,
  Constants,
  ContentTypes,
  ToolCallTypes,
  imageGenTools,
  isImageVisionTool,
} from 'librechat-data-provider';
import { memo, useMemo } from 'react';
import type { TMessageContentParts, TAttachment, Agents } from 'librechat-data-provider';
import { OpenAIImageGen, EmptyText, Reasoning, ExecuteCode, AgentUpdate, Text } from './Parts';
import { useGetStartupConfig } from '~/data-provider';
import { ErrorMessage } from './MessageContent';
import RetrievalCall from './RetrievalCall';
import AgentHandoff from './AgentHandoff';
import CodeAnalyze from './CodeAnalyze';
import Container from './Container';
import WebSearch from './WebSearch';
import ToolCall from './ToolCall';
import ImageGen from './ImageGen';
import Image from './Image';

/**
 * Checks if tool execution indicators should be hidden for an MCP tool call
 * @param toolName - The full tool name (e.g., "get_price_mcp_my-server")
 * @param mcpServers - MCP servers configuration from startup config
 * @returns true if the tool call should be hidden
 */
function shouldHideMCPToolCall(
  toolName: string | undefined,
  mcpServers: Record<string, { hideToolCalls?: boolean }> | undefined,
): boolean {
  if (!toolName || !mcpServers) {
    return false;
  }

  // Check if this is an MCP tool call
  if (!toolName.includes(Constants.mcp_delimiter)) {
    return false;
  }

  // Extract server name from the tool name (format: toolName_mcp_serverName)
  const [, serverName] = toolName.split(Constants.mcp_delimiter);
  if (!serverName) {
    return false;
  }

  // Check if this server has hideToolCalls enabled
  return mcpServers[serverName]?.hideToolCalls === true;
}

type PartProps = {
  part?: TMessageContentParts;
  isLast?: boolean;
  isSubmitting: boolean;
  showCursor: boolean;
  isCreatedByUser: boolean;
  attachments?: TAttachment[];
};

const Part = memo(
  ({ part, isSubmitting, attachments, isLast, showCursor, isCreatedByUser }: PartProps) => {
    const { data: startupConfig } = useGetStartupConfig();

    // Memoize the tool name extraction for MCP tool call hiding check
    const toolNameForHiding = useMemo(() => {
      if (part?.type !== ContentTypes.TOOL_CALL) {
        return undefined;
      }
      const toolCall = part[ContentTypes.TOOL_CALL] as Agents.ToolCall | undefined;
      if (!toolCall) {
        return undefined;
      }
      // Handle both direct tool calls and function-style tool calls
      if ('name' in toolCall && toolCall.name) {
        return toolCall.name;
      }
      if ('function' in toolCall && toolCall.function?.name) {
        return toolCall.function.name;
      }
      return undefined;
    }, [part]);

    // Check if this MCP tool call should be hidden
    const shouldHideToolCall = useMemo(
      () => shouldHideMCPToolCall(toolNameForHiding, startupConfig?.mcpServers),
      [toolNameForHiding, startupConfig?.mcpServers],
    );

    if (!part) {
      return null;
    }

    if (part.type === ContentTypes.ERROR) {
      return (
        <ErrorMessage
          text={
            part[ContentTypes.ERROR] ??
            (typeof part[ContentTypes.TEXT] === 'string'
              ? part[ContentTypes.TEXT]
              : part.text?.value) ??
            ''
          }
          className="my-2"
        />
      );
    } else if (part.type === ContentTypes.AGENT_UPDATE) {
      return (
        <>
          <AgentUpdate currentAgentId={part[ContentTypes.AGENT_UPDATE]?.agentId} />
          {isLast && showCursor && (
            <Container>
              <EmptyText />
            </Container>
          )}
        </>
      );
    } else if (part.type === ContentTypes.TEXT) {
      const text = typeof part.text === 'string' ? part.text : part.text?.value;

      if (typeof text !== 'string') {
        return null;
      }
      if (part.tool_call_ids != null && !text) {
        return null;
      }
      /** Skip rendering if text is only whitespace to avoid empty Container */
      if (!isLast && text.length > 0 && /^\s*$/.test(text)) {
        return null;
      }
      return (
        <Container>
          <Text text={text} isCreatedByUser={isCreatedByUser} showCursor={showCursor} />
        </Container>
      );
    } else if (part.type === ContentTypes.THINK) {
      const reasoning = typeof part.think === 'string' ? part.think : part.think?.value;
      if (typeof reasoning !== 'string') {
        return null;
      }
      return <Reasoning reasoning={reasoning} isLast={isLast ?? false} />;
    } else if (part.type === ContentTypes.TOOL_CALL) {
      const toolCall = part[ContentTypes.TOOL_CALL];

      if (!toolCall) {
        return null;
      }

      const isToolCall =
        'args' in toolCall && (!toolCall.type || toolCall.type === ToolCallTypes.TOOL_CALL);
      if (isToolCall && toolCall.name === Tools.execute_code) {
        return (
          <ExecuteCode
            attachments={attachments}
            isSubmitting={isSubmitting}
            output={toolCall.output ?? ''}
            initialProgress={toolCall.progress ?? 0.1}
            args={typeof toolCall.args === 'string' ? toolCall.args : ''}
          />
        );
      } else if (
        isToolCall &&
        (toolCall.name === 'image_gen_oai' || toolCall.name === 'image_edit_oai')
      ) {
        return (
          <OpenAIImageGen
            initialProgress={toolCall.progress ?? 0.1}
            isSubmitting={isSubmitting}
            toolName={toolCall.name}
            args={typeof toolCall.args === 'string' ? toolCall.args : ''}
            output={toolCall.output ?? ''}
            attachments={attachments}
          />
        );
      } else if (isToolCall && toolCall.name === Tools.web_search) {
        return (
          <WebSearch
            output={toolCall.output ?? ''}
            initialProgress={toolCall.progress ?? 0.1}
            isSubmitting={isSubmitting}
            attachments={attachments}
            isLast={isLast}
          />
        );
      } else if (isToolCall && toolCall.name?.startsWith(Constants.LC_TRANSFER_TO_)) {
        return (
          <AgentHandoff
            args={toolCall.args ?? ''}
            name={toolCall.name || ''}
            output={toolCall.output ?? ''}
          />
        );
      } else if (isToolCall) {
        // Hide MCP tool call execution indicators if configured
        if (shouldHideToolCall) {
          return null;
        }
        return (
          <ToolCall
            args={toolCall.args ?? ''}
            name={toolCall.name || ''}
            output={toolCall.output ?? ''}
            initialProgress={toolCall.progress ?? 0.1}
            isSubmitting={isSubmitting}
            attachments={attachments}
            auth={toolCall.auth}
            expires_at={toolCall.expires_at}
            isLast={isLast}
          />
        );
      } else if (toolCall.type === ToolCallTypes.CODE_INTERPRETER) {
        const code_interpreter = toolCall[ToolCallTypes.CODE_INTERPRETER];
        return (
          <CodeAnalyze
            initialProgress={toolCall.progress ?? 0.1}
            code={code_interpreter.input}
            outputs={code_interpreter.outputs ?? []}
          />
        );
      } else if (
        toolCall.type === ToolCallTypes.RETRIEVAL ||
        toolCall.type === ToolCallTypes.FILE_SEARCH
      ) {
        return (
          <RetrievalCall initialProgress={toolCall.progress ?? 0.1} isSubmitting={isSubmitting} />
        );
      } else if (
        toolCall.type === ToolCallTypes.FUNCTION &&
        ToolCallTypes.FUNCTION in toolCall &&
        imageGenTools.has(toolCall.function.name)
      ) {
        return (
          <ImageGen
            initialProgress={toolCall.progress ?? 0.1}
            args={toolCall.function.arguments as string}
          />
        );
      } else if (toolCall.type === ToolCallTypes.FUNCTION && ToolCallTypes.FUNCTION in toolCall) {
        if (isImageVisionTool(toolCall)) {
          if (isSubmitting && showCursor) {
            return (
              <Container>
                <Text text={''} isCreatedByUser={isCreatedByUser} showCursor={showCursor} />
              </Container>
            );
          }
          return null;
        }

        // Hide MCP tool call execution indicators if configured
        if (shouldHideToolCall) {
          return null;
        }

        return (
          <ToolCall
            initialProgress={toolCall.progress ?? 0.1}
            isSubmitting={isSubmitting}
            args={toolCall.function.arguments as string}
            name={toolCall.function.name}
            output={toolCall.function.output}
            isLast={isLast}
          />
        );
      }
    } else if (part.type === ContentTypes.IMAGE_FILE) {
      const imageFile = part[ContentTypes.IMAGE_FILE];
      const height = imageFile.height ?? 1920;
      const width = imageFile.width ?? 1080;
      return (
        <Image
          imagePath={imageFile.filepath}
          height={height}
          width={width}
          altText={imageFile.filename ?? 'Uploaded Image'}
          placeholderDimensions={{
            height: height + 'px',
            width: width + 'px',
          }}
        />
      );
    }

    return null;
  },
);

export default Part;
