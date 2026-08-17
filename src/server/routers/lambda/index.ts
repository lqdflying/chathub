/**
 * This file contains the root router of Lobe Chat tRPC-backend
 */
import { publicProcedure, router } from '@/libs/trpc/lambda';

import { agentRouter } from './agent';
import { aiChatRouter } from './aiChat';
import { aiModelRouter } from './aiModel';
import { aiProviderRouter } from './aiProvider';
import { apiKeyRouter } from './apiKey';
import { chunkRouter } from './chunk';
import { comfyuiRouter } from './comfyui';
import { configRouter } from './config';
import { conversationGenerationRouter } from './conversationGeneration';
import { documentRouter } from './document';
import { exporterRouter } from './exporter';
import { fileRouter } from './file';
import { generationRouter } from './generation';
import { generationBatchRouter } from './generationBatch';
import { generationTopicRouter } from './generationTopic';
import { groupRouter } from './group';
import { imageRouter } from './image';
import { knowledgeBaseRouter } from './knowledgeBase';
import { marketRouter } from './market';
import { messageRouter } from './message';
import { picbedRouter } from './picbed';
import { pluginRouter } from './plugin';
import { ragEvalRouter } from './ragEval';
import { ragProviderRouter } from './ragProvider';
import { sessionRouter } from './session';
import { sessionGroupRouter } from './sessionGroup';
import { skillRouter } from './skill';
import { threadRouter } from './thread';
import { topicRouter } from './topic';
import { uploadRouter } from './upload';
import { userRouter } from './user';

export const lambdaRouter = router({
  agent: agentRouter,
  aiChat: aiChatRouter,
  aiModel: aiModelRouter,
  aiProvider: aiProviderRouter,
  apiKey: apiKeyRouter,
  chunk: chunkRouter,
  comfyui: comfyuiRouter,
  config: configRouter,
  conversationGeneration: conversationGenerationRouter,
  document: documentRouter,
  exporter: exporterRouter,
  file: fileRouter,
  generation: generationRouter,
  generationBatch: generationBatchRouter,
  generationTopic: generationTopicRouter,
  group: groupRouter,
  healthcheck: publicProcedure.query(() => "i'm live!"),
  image: imageRouter,
  knowledgeBase: knowledgeBaseRouter,
  market: marketRouter,
  message: messageRouter,
  picbed: picbedRouter,
  plugin: pluginRouter,
  ragEval: ragEvalRouter,
  ragProvider: ragProviderRouter,
  session: sessionRouter,
  sessionGroup: sessionGroupRouter,
  skill: skillRouter,
  thread: threadRouter,
  topic: topicRouter,
  upload: uploadRouter,
  user: userRouter,
});

export type LambdaRouter = typeof lambdaRouter;
