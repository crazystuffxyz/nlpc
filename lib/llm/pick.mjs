// pick a model from the ollama list when the user didn't pick one
import { Ollama } from 'ollama';

export async function pickModel(host) {
  const client = new Ollama({ host });
  const res = await client.list();
  const models = (res.models || []).map(m => m.name).filter(Boolean);
  if (!models.length) {
    throw new Error(
      `no ollama models installed. run 'ollama pull <name>' first ` +
      `(e.g. ollama pull codellama:7b-instruct), then retry.`
    );
  }
  return models[0];
}
