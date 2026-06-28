import ProviderGrid from '../(list)/ProviderGrid';
import AnthropicCompatible from './anthropiccompatible';
import Azure from './azure';
import AzureAI from './azureai';
import DefaultPage from './default/ProviderDetialPage';
import OpenAI from './openai';

const ProviderDetailPage = (props: { id?: string | null }) => {
  const { id } = props;

  switch (id) {
    case 'all': {
      return <ProviderGrid />;
    }
    case 'anthropiccompatible': {
      return <AnthropicCompatible />;
    }
    case 'azure': {
      return <Azure />;
    }
    case 'azureai': {
      return <AzureAI />;
    }
    case 'openai': {
      return <OpenAI />;
    }
    default: {
      return <DefaultPage id={id} />;
    }
  }
};

export default ProviderDetailPage;
