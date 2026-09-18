/**
 * Signal token relabeling (spec §35/§36).
 *
 * The simulation core always works with canonical signals 'A' | 'B'. What a
 * DecisionProvider actually sees as the "identifier" of a signal can be
 * relabeled to a random opaque token so a language model provider cannot
 * lean on training-data priors attached to the letters "A"/"B".
 *
 * IMPORTANT: this module must never attach any concept/meaning to a signal.
 * It only produces opaque, collision-free identifiers.
 */
import { SeededRandom } from '../rng';
import type { SignalDefinition, SignalTokenMode } from '../types';

const RESERVED = new Set(['NONE']);

export function createSignalDefinitions(seed: number, mode: SignalTokenMode): SignalDefinition[] {
  if (mode === 'AB') {
    return [
      { signal: 'A', id: 'A', displayName: 'A' },
      { signal: 'B', id: 'B', displayName: 'B' },
    ];
  }

  const rng = new SeededRandom(seed).fork('signal-tokens');
  const used = new Set<string>(RESERVED);

  const makeToken = (): string => {
    let token: string;
    do {
      token = `SIG_${rng.token(3)}`;
    } while (used.has(token));
    used.add(token);
    return token;
  };

  return [
    { signal: 'A', id: makeToken(), displayName: 'A' },
    { signal: 'B', id: makeToken(), displayName: 'B' },
  ];
}
