import MemoryContextOrchestrator from '@/features/Conversation/components/ContextMemory/MemoryContextOrchestrator';
import { EstimatedContextUsageProvider } from '@/hooks/EstimatedContextUsageProvider';

import DesktopChatInput from './Desktop';
import MobileChatInput from './V1Mobile';

interface ChatInputProps {
  mobile: boolean;
  targetMemberId?: string;
}

const ChatInput = ({ mobile, targetMemberId }: ChatInputProps) => {
  const Input = mobile ? MobileChatInput : DesktopChatInput;

  return (
    <EstimatedContextUsageProvider>
      {mobile && <MemoryContextOrchestrator />}
      <Input targetMemberId={targetMemberId} />
    </EstimatedContextUsageProvider>
  );
};

export default ChatInput;
