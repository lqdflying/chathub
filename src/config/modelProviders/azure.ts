import { ModelProviderCard } from '@/types/llm';

const Azure: ModelProviderCard = {
  chatModels: [],
  defaultShowBrowserRequest: true,
  description:
    'Azure OpenAI in Microsoft Foundry hosts GPT-5.6, GPT-5.5, and GPT-5.4 models billed through your Azure subscription, with regional deployment names and Azure SLAs.',
  id: 'azure',
  modelsUrl: 'https://learn.microsoft.com/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure',
  name: 'Azure OpenAI',
  settings: {
    defaultShowBrowserRequest: true,
    sdkType: 'azure',
    showDeployName: true,
  },
  url: 'https://azure.microsoft.com',
};

export default Azure;
