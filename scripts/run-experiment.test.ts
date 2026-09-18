import { describe, expect, it } from 'vitest';
import { parseArgs } from './run-experiment';

describe('run-experiment CLI arg parsing', () => {
  it('defaults to seed 1, COMMUNICATION mode, WITH_MEMORY, 2000 ticks, mock provider', () => {
    const args = parseArgs([]);
    expect(args).toMatchObject({
      seeds: [1],
      modes: ['COMMUNICATION'],
      memories: ['WITH_MEMORY'],
      ticks: 2000,
      provider: 'mock',
      out: 'experiments-out',
      compare: false,
    });
  });

  it('parses a comma-separated --seed list', () => {
    const args = parseArgs(['--seed', '1,2,3']);
    expect(args.seeds).toEqual([1, 2, 3]);
  });

  it('parses a --seeds range', () => {
    const args = parseArgs(['--seeds', '5-8']);
    expect(args.seeds).toEqual([5, 6, 7, 8]);
  });

  it('expands --mode all to every ExperimentMode', () => {
    const args = parseArgs(['--mode', 'all']);
    expect(args.modes.sort()).toEqual(['COMMUNICATION', 'NO_COMMUNICATION', 'SHUFFLED_COMMUNICATION'].sort());
  });

  it('rejects an unknown --mode', () => {
    expect(() => parseArgs(['--mode', 'BOGUS'])).toThrow();
  });

  it('expands --memory both', () => {
    const args = parseArgs(['--memory', 'both']);
    expect(args.memories).toEqual(['WITH_MEMORY', 'NO_MEMORY']);
  });

  it('parses --ticks, --provider and --out', () => {
    const args = parseArgs(['--ticks', '500', '--provider', 'random', '--out', 'my-out']);
    expect(args.ticks).toBe(500);
    expect(args.provider).toBe('random');
    expect(args.out).toBe('my-out');
  });

  it('parses --config overrides with numbers, booleans and strings', () => {
    const args = parseArgs(['--config', 'maxPopulation=200,mutationRate=0.1,predatorRespawn=true']);
    expect(args.configOverrides).toEqual({
      maxPopulation: 200,
      mutationRate: 0.1,
      predatorRespawn: true,
    });
  });

  it('recognizes the --compare flag', () => {
    expect(parseArgs(['--compare']).compare).toBe(true);
    expect(parseArgs([]).compare).toBe(false);
  });

  it('supports --flag=value syntax', () => {
    const args = parseArgs(['--ticks=999', '--provider=jev']);
    expect(args.ticks).toBe(999);
    expect(args.provider).toBe('jev');
  });
});
