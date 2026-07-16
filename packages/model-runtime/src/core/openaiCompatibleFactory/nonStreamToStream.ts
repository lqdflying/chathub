import OpenAI from 'openai';

/**
 * make the OpenAI response data as a stream
 */
export const transformResponseToStream = (data: OpenAI.ChatCompletion) =>
  new ReadableStream({
    start(controller) {
      const choices = data.choices || [];
      const first = choices[0];
      // 兼容：非流式里 DeepSeek 等会把“深度思考”放在 message.reasoning_content
      const message: any = first?.message ?? {};
      const reasoningText =
        typeof message.reasoning_content === 'string' && message.reasoning_content.length > 0
          ? message.reasoning_content
          : null;
      if (reasoningText) {
        controller.enqueue({
          choices: [
            {
              delta: { content: null, reasoning_content: reasoningText, role: 'assistant' },
              finish_reason: null,
              index: first?.index ?? 0,
              logprobs: first?.logprobs ?? null,
            },
          ],
          created: data.created,
          id: data.id,
          model: data.model,
          object: 'chat.completion.chunk',
        } as unknown as OpenAI.ChatCompletionChunk);
      }
      const chunk: OpenAI.ChatCompletionChunk = {
        choices: choices.map((choice: OpenAI.ChatCompletion.Choice) => ({
          delta: {
            content: choice.message.content,
            role: choice.message.role,
            tool_calls: choice.message.tool_calls?.map(
              (tool, index): OpenAI.ChatCompletionChunk.Choice.Delta.ToolCall => ({
                function: (tool as OpenAI.ChatCompletionMessageFunctionToolCall).function,
                id: tool.id,
                index,
                type: 'function',
              }),
            ),
          },
          finish_reason: null,
          index: choice.index,
          logprobs: choice.logprobs,
        })),
        created: data.created,
        id: data.id,
        model: data.model,
        object: 'chat.completion.chunk',
      };

      controller.enqueue(chunk);
      if (data.usage) {
        controller.enqueue({
          choices: [],
          created: data.created,
          id: data.id,
          model: data.model,
          object: 'chat.completion.chunk',
          usage: data.usage,
        } as unknown as OpenAI.ChatCompletionChunk);
      }
      controller.enqueue({
        choices: choices.map((choice: OpenAI.ChatCompletion.Choice) => ({
          delta: {
            content: null,
            role: choice.message.role,
          },
          finish_reason: choice.finish_reason,
          index: choice.index,
          logprobs: choice.logprobs,
        })),
        created: data.created,
        id: data.id,
        model: data.model,
        object: 'chat.completion.chunk',
        system_fingerprint: data.system_fingerprint,
      } as OpenAI.ChatCompletionChunk);
      controller.close();
    },
  });

/**
 * transform the OpenAI Response API data to stream format for non-streaming responses
 */
export const transformResponseAPIToStream = (data: OpenAI.Responses.Response) =>
  new ReadableStream<OpenAI.Responses.ResponseStreamEvent>({
    start(controller) {
      let sequenceNumber = 0;
      const enqueueEvent = (event: Omit<OpenAI.Responses.ResponseStreamEvent, 'sequence_number'>) => {
        controller.enqueue({
          ...event,
          sequence_number: sequenceNumber,
        } as OpenAI.Responses.ResponseStreamEvent);
        sequenceNumber += 1;
      };

      enqueueEvent({
        response: {
          ...data,
          output: [],
          status: 'in_progress',
          usage: null,
        },
        type: 'response.created',
      } as Omit<OpenAI.Responses.ResponseCreatedEvent, 'sequence_number'>);

      data.output?.forEach((outputItem, outputIndex) => {
        const itemId = outputItem.id || `${data.id}:output:${outputIndex}`;

        enqueueEvent({
          item: outputItem,
          output_index: outputIndex,
          type: 'response.output_item.added',
        } as Omit<OpenAI.Responses.ResponseOutputItemAddedEvent, 'sequence_number'>);

        switch (outputItem.type) {
          case 'message': {
            outputItem.content?.forEach((content, contentIndex) => {
              if (content.type === 'output_text') {
                if (content.text) {
                  enqueueEvent({
                    content_index: contentIndex,
                    delta: content.text,
                    item_id: itemId,
                    logprobs: content.logprobs || [],
                    output_index: outputIndex,
                    type: 'response.output_text.delta',
                  } as Omit<OpenAI.Responses.ResponseTextDeltaEvent, 'sequence_number'>);
                }

                content.annotations
                  ?.filter((annotation) => annotation.type === 'url_citation')
                  .forEach((annotation, annotationIndex) => {
                    enqueueEvent({
                      annotation,
                      annotation_index: annotationIndex,
                      content_index: contentIndex,
                      item_id: itemId,
                      output_index: outputIndex,
                      type: 'response.output_text.annotation.added',
                    } as Omit<
                      OpenAI.Responses.ResponseOutputTextAnnotationAddedEvent,
                      'sequence_number'
                    >);
                  });
              } else if (content.type === 'refusal' && content.refusal) {
                enqueueEvent({
                  content_index: contentIndex,
                  delta: content.refusal,
                  item_id: itemId,
                  output_index: outputIndex,
                  type: 'response.refusal.delta',
                } as Omit<OpenAI.Responses.ResponseRefusalDeltaEvent, 'sequence_number'>);
              }
            });
            break;
          }

          case 'function_call': {
            enqueueEvent({
              arguments: outputItem.arguments,
              item_id: itemId,
              name: outputItem.name,
              output_index: outputIndex,
              type: 'response.function_call_arguments.done',
            } as Omit<
              OpenAI.Responses.ResponseFunctionCallArgumentsDoneEvent,
              'sequence_number'
            >);
            break;
          }

          case 'reasoning': {
            outputItem.summary.forEach((summary, summaryIndex) => {
              enqueueEvent({
                item_id: itemId,
                output_index: outputIndex,
                part: summary,
                summary_index: summaryIndex,
                type: 'response.reasoning_summary_part.added',
              } as Omit<
                OpenAI.Responses.ResponseReasoningSummaryPartAddedEvent,
                'sequence_number'
              >);

              if (summary.text) {
                enqueueEvent({
                  delta: summary.text,
                  item_id: itemId,
                  output_index: outputIndex,
                  summary_index: summaryIndex,
                  type: 'response.reasoning_summary_text.delta',
                } as Omit<
                  OpenAI.Responses.ResponseReasoningSummaryTextDeltaEvent,
                  'sequence_number'
                >);
              }
            });

            outputItem.content?.forEach((content, contentIndex) => {
              if (!content.text) return;

              enqueueEvent({
                content_index: contentIndex,
                delta: content.text,
                item_id: itemId,
                output_index: outputIndex,
                type: 'response.reasoning_text.delta',
              } as Omit<OpenAI.Responses.ResponseReasoningTextDeltaEvent, 'sequence_number'>);
            });
            break;
          }
        }

        enqueueEvent({
          item: outputItem,
          output_index: outputIndex,
          type: 'response.output_item.done',
        } as Omit<OpenAI.Responses.ResponseOutputItemDoneEvent, 'sequence_number'>);
      });

      const terminalEventType =
        data.status === 'completed'
          ? 'response.completed'
          : data.status === 'failed'
            ? 'response.failed'
            : 'response.incomplete';

      enqueueEvent({
        response: data,
        type: terminalEventType,
      } as Omit<
        | OpenAI.Responses.ResponseCompletedEvent
        | OpenAI.Responses.ResponseFailedEvent
        | OpenAI.Responses.ResponseIncompleteEvent,
        'sequence_number'
      >);

      controller.close();
    },
  });
