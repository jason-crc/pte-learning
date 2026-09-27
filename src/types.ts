export type ReviewResult = 'known' | 'unknown';
export type MessageIdentity = 'bot' | 'user';

export interface WordSeed {
  slug: string;
  word: string;
  phonetic: string;
  partOfSpeech: string;
  meaningZh: string;
  example: string;
  exampleZh: string;
  tags: string[];
}

export interface StudyItem extends WordSeed {
  id: number;
  enabled: boolean;
}

export interface Subscriber {
  userOpenId: string;
  chatId: string;
  displayName: string;
  messageIdentity: MessageIdentity;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Progress {
  userOpenId: string;
  itemId: number;
  knownStreak: number;
  dueAt: number;
  lastResult: ReviewResult;
  lastReviewedAt: number;
  knownCount: number;
  unknownCount: number;
}

export interface ReviewOutcome {
  created: boolean;
  result: ReviewResult;
  dueAt: number;
  knownStreak: number;
}

export interface Delivery {
  userOpenId: string;
  chatId: string;
  itemId: number;
  messageId: string;
  deliveryKey: string;
  createdAt: number;
  dismissedAt?: number;
}

export interface UserStats {
  totalItems: number;
  learnedItems: number;
  dueItems: number;
  totalReviews: number;
  todayReviews: number;
  knownReviews: number;
  unknownReviews: number;
}
