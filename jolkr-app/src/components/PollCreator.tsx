import { useState } from 'react';
import * as api from '../api/client';
import Button from './ui/Button';
import Modal from './ui/Modal';

export interface PollCreatorProps {
  channelId: string;
  onClose: () => void;
  onCreated: () => void;
}

export default function PollCreator({ channelId, onClose, onCreated }: PollCreatorProps) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(() => [
    { id: crypto.randomUUID(), value: '' },
    { id: crypto.randomUUID(), value: '' },
  ]);
  const [multiSelect, setMultiSelect] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [expiresIn, setExpiresIn] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const addOption = () => {
    if (options.length < 10) setOptions([...options, { id: crypto.randomUUID(), value: '' }]);
  };

  const removeOption = (id: string) => {
    if (options.length > 2) setOptions(options.filter((o) => o.id !== id));
  };

  const updateOption = (id: string, value: string) => {
    setOptions(options.map((o) => (o.id === id ? { ...o, value } : o)));
  };

  const handleSubmit = async () => {
    if (!question.trim()) { setError('Question is required'); return; }
    const validOptions = options.map((o) => o.value).filter((v) => v.trim());
    if (validOptions.length < 2) { setError('At least 2 options are required'); return; }

    setLoading(true);
    setError('');
    try {
      const body: { question: string; options: string[]; multi_select?: boolean; anonymous?: boolean; expires_at?: string } = {
        question: question.trim(),
        options: validOptions,
      };
      if (multiSelect) body.multi_select = true;
      if (anonymous) body.anonymous = true;
      if (expiresIn) {
        const hours = parseInt(expiresIn);
        if (hours > 0) body.expires_at = new Date(Date.now() + hours * 3600000).toISOString();
      }
      await api.createPoll(channelId, body);
      onCreated();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open onClose={onClose} className="p-8 w-110 max-w-[90vw] max-h-[90vh]">
        <h3 className="text-text-primary text-lg font-semibold mb-4">Create Poll</h3>

        {error && (
          <div className="bg-danger/10 text-danger text-sm p-2 rounded-lg mb-3">{error}</div>
        )}

        <label className="text-xs font-bold text-text-secondary uppercase tracking-wider">
          Question
        </label>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a question..."
          className="w-full mt-1 px-3 py-2 bg-bg border border-divider rounded-lg text-text-primary text-sm mb-3"
          maxLength={500}
          autoFocus
        />

        <label className="text-xs font-bold text-text-secondary uppercase tracking-wider">
          Options
        </label>
        <div className="space-y-1.5 mt-1 mb-3">
          {options.map((opt, i) => (
            <div key={opt.id} className="flex gap-2">
              <input
                value={opt.value}
                onChange={(e) => updateOption(opt.id, e.target.value)}
                placeholder={`Option ${i + 1}`}
                className="flex-1 px-3 py-2 bg-bg border border-divider rounded-lg text-text-primary text-sm"
                maxLength={200}
              />
              {options.length > 2 && (
                <button
                  onClick={() => removeOption(opt.id)}
                  className="text-text-tertiary hover:text-danger text-sm px-1"
                >
                  x
                </button>
              )}
            </div>
          ))}
          {options.length < 10 && (
            <button
              onClick={addOption}
              className="text-accent text-sm hover:underline"
            >
              + Add option
            </button>
          )}
        </div>

        <div className="flex items-center gap-4 mb-3">
          <label className="flex items-center gap-1.5 text-sm text-text-secondary cursor-pointer">
            <input type="checkbox" checked={multiSelect} onChange={(e) => setMultiSelect(e.target.checked)} className="accent-primary" />
            Multi-select
          </label>
          <label className="flex items-center gap-1.5 text-sm text-text-secondary cursor-pointer">
            <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} className="accent-primary" />
            Anonymous
          </label>
        </div>

        <label className="text-xs font-bold text-text-secondary uppercase tracking-wider">
          Expires After
        </label>
        <select
          value={expiresIn}
          onChange={(e) => setExpiresIn(e.target.value)}
          className="w-full mt-1 px-4 py-3 bg-bg border border-divider rounded-lg text-text-primary text-sm mb-4"
        >
          <option value="">Never</option>
          <option value="1">1 hour</option>
          <option value="6">6 hours</option>
          <option value="12">12 hours</option>
          <option value="24">1 day</option>
          <option value="72">3 days</option>
          <option value="168">1 week</option>
        </select>

        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2.5 text-sm text-text-secondary hover:text-text-primary">
            Cancel
          </button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? 'Creating...' : 'Create Poll'}
          </Button>
        </div>
    </Modal>
  );
}
