interface CausalMessageFields {
  createdAt?: Date | number | string | null;
  id: string;
  parentId?: string | null;
}

export const removeMessageOrder = <Message extends object>(
  message: Message & { messageOrder?: bigint },
): Omit<Message, 'messageOrder'> => {
  const publicMessage = { ...message };
  delete publicMessage.messageOrder;
  return publicMessage;
};

const getCreatedAtValue = (createdAt: CausalMessageFields['createdAt']): number => {
  if (createdAt instanceof Date) return createdAt.getTime();
  if (typeof createdAt === 'number') return createdAt;
  if (typeof createdAt === 'string') {
    const timestamp = new Date(createdAt).getTime();
    return Number.isNaN(timestamp) ? Number.MAX_SAFE_INTEGER : timestamp;
  }

  return Number.MAX_SAFE_INTEGER;
};

class BinaryMinHeap<Item> {
  private readonly compareItems: (firstItem: Item, secondItem: Item) => number;
  private readonly items: Item[] = [];

  constructor(compareItems: (firstItem: Item, secondItem: Item) => number) {
    this.compareItems = compareItems;
  }

  get size(): number {
    return this.items.length;
  }

  pop(): Item | undefined {
    const minimumItem = this.items[0];
    const lastItem = this.items.pop();

    if (this.items.length === 0 || lastItem === undefined) return minimumItem;

    this.items[0] = lastItem;
    this.siftDown(0);

    return minimumItem;
  }

  push(item: Item): void {
    this.items.push(item);
    this.siftUp(this.items.length - 1);
  }

  private siftDown(startIndex: number): void {
    let parentIndex = startIndex;
    let leftChildIndex = parentIndex * 2 + 1;

    while (leftChildIndex < this.items.length) {
      const rightChildIndex = leftChildIndex + 1;
      let minimumIndex = parentIndex;

      if (this.compareItems(this.items[leftChildIndex], this.items[minimumIndex]) < 0) {
        minimumIndex = leftChildIndex;
      }

      if (
        rightChildIndex < this.items.length &&
        this.compareItems(this.items[rightChildIndex], this.items[minimumIndex]) < 0
      ) {
        minimumIndex = rightChildIndex;
      }

      if (minimumIndex === parentIndex) return;

      [this.items[parentIndex], this.items[minimumIndex]] = [
        this.items[minimumIndex],
        this.items[parentIndex],
      ];
      parentIndex = minimumIndex;
      leftChildIndex = parentIndex * 2 + 1;
    }
  }

  private siftUp(startIndex: number): void {
    let childIndex = startIndex;

    while (childIndex > 0) {
      const parentIndex = Math.floor((childIndex - 1) / 2);
      if (this.compareItems(this.items[parentIndex], this.items[childIndex]) <= 0) return;

      [this.items[parentIndex], this.items[childIndex]] = [
        this.items[childIndex],
        this.items[parentIndex],
      ];
      childIndex = parentIndex;
    }
  }
}

export const sortMessagesParentFirst = <Message>(
  messageList: Message[],
  getFields: (message: Message) => CausalMessageFields = (message) =>
    message as CausalMessageFields,
): Message[] => {
  const sourceIndexByMessageId = new Map(
    messageList.map((message, sourceIndex) => [getFields(message).id, sourceIndex] as const),
  );
  const compareMessages = (firstMessage: Message, secondMessage: Message): number => {
    const firstFields = getFields(firstMessage);
    const secondFields = getFields(secondMessage);
    const createdAtDifference =
      getCreatedAtValue(firstFields.createdAt) - getCreatedAtValue(secondFields.createdAt);

    if (createdAtDifference !== 0) return createdAtDifference;
    return (
      (sourceIndexByMessageId.get(firstFields.id) ?? Number.MAX_SAFE_INTEGER) -
      (sourceIndexByMessageId.get(secondFields.id) ?? Number.MAX_SAFE_INTEGER)
    );
  };

  const messageById = new Map(
    messageList.map((message) => {
      const { id } = getFields(message);
      return [id, message] as const;
    }),
  );
  const childMessagesByParentId = new Map<string, Message[]>();
  const dependencyCountByMessageId = new Map<string, number>();

  for (const message of messageList) {
    const { id, parentId } = getFields(message);
    const parentMessage = parentId ? messageById.get(parentId) : undefined;
    const hasParentDependency = !!parentMessage && parentId !== id;

    dependencyCountByMessageId.set(id, hasParentDependency ? 1 : 0);

    if (hasParentDependency && parentId) {
      const childMessages = childMessagesByParentId.get(parentId) || [];
      childMessages.push(message);
      childMessagesByParentId.set(parentId, childMessages);
    }
  }

  const availableMessages = new BinaryMinHeap(compareMessages);
  for (const message of messageList) {
    if (dependencyCountByMessageId.get(getFields(message).id) === 0) {
      availableMessages.push(message);
    }
  }
  const sortedMessages: Message[] = [];
  const sortedMessageIds = new Set<string>();

  while (availableMessages.size > 0) {
    const nextMessage = availableMessages.pop()!;
    const { id } = getFields(nextMessage);

    if (sortedMessageIds.has(id)) continue;

    sortedMessageIds.add(id);
    sortedMessages.push(nextMessage);

    for (const childMessage of childMessagesByParentId.get(id) || []) {
      const childId = getFields(childMessage).id;
      const remainingDependencies = (dependencyCountByMessageId.get(childId) || 1) - 1;
      dependencyCountByMessageId.set(childId, remainingDependencies);

      if (remainingDependencies === 0) {
        availableMessages.push(childMessage);
      }
    }
  }

  const cyclicOrMalformedMessages = messageList
    .filter((message) => !sortedMessageIds.has(getFields(message).id))
    .sort(compareMessages);

  return [...sortedMessages, ...cyclicOrMalformedMessages];
};
