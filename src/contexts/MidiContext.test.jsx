import { describe, it, expect } from 'vitest';
import { generateFeedbackMap } from './MidiContext';

describe('MidiContext Feedback Lookup Optimization', () => {
  it('should correctly map controlIds to their hardware assignments', () => {
    const mappings = {
      'note:1:60': [
        { controlId: 'clip_0_0', label: 'Clip 1' },
        { controlId: 'master_intensity', label: 'Master' }
      ],
      'cc:1:10': [
        { controlId: 'master_intensity', label: 'Master Knob' }
      ]
    };

    const feedbackMap = generateFeedbackMap(mappings);

    // Test clip_0_0 lookup
    const clipAssignments = feedbackMap.get('clip_0_0');
    expect(clipAssignments).toHaveLength(1);
    expect(clipAssignments[0].key).toBe('note:1:60');
    expect(clipAssignments[0].assignment.label).toBe('Clip 1');

    // Test master_intensity lookup (multiple hardware keys mapped to same control)
    const masterAssignments = feedbackMap.get('master_intensity');
    expect(masterAssignments).toHaveLength(2);
    expect(masterAssignments.some(a => a.key === 'note:1:60')).toBe(true);
    expect(masterAssignments.some(a => a.key === 'cc:1:10')).toBe(true);
  });

  it('should return undefined for unmapped controlIds', () => {
    const feedbackMap = generateFeedbackMap({});
    expect(feedbackMap.get('unknown')).toBeUndefined();
  });
});
