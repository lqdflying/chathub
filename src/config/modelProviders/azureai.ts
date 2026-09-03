import { ModelProviderCard } from '@/types/llm';

const Azure: ModelProviderCard = {
  chatModels: [],
  description:
    'Azure AI in Microsoft Foundry hosts GPT-5.6, GPT-5.5, and GPT-5.4 models billed through your Azure subscription.',
  id: 'azureai',
  modelsUrl: 'https://learn.microsoft.com/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure',
  name: 'Azure AI',
  settings: {
    defaultShowBrowserRequest: true,
    sdkType: 'azureai',
    showDeployName: true,
  },
  url: 'https://ai.azure.com',
};

export default Azure;
