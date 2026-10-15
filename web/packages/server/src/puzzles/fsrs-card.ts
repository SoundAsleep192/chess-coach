import type { Card } from 'ts-fsrs';
import type { CardDoc } from './puzzle-repository';

export type CardFields = Pick<
  CardDoc,
  'due' | 'stability' | 'difficulty' | 'elapsed_days' | 'scheduled_days' | 'learning_steps' | 'reps' | 'lapses' | 'state' | 'last_review'
>;

export function toCard(doc: CardDoc): Card {
  return {
    due: doc.due,
    stability: doc.stability,
    difficulty: doc.difficulty,
    elapsed_days: doc.elapsed_days,
    scheduled_days: doc.scheduled_days,
    learning_steps: doc.learning_steps,
    reps: doc.reps,
    lapses: doc.lapses,
    state: doc.state,
    last_review: doc.last_review,
  };
}

export function fromCard(card: Card): CardFields {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review,
  };
}
