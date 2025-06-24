export async function transcribeAudioWithOpenAI(blob: Blob): Promise<string> {
  const apiKey = process.env.NEXT_PUBLIC_OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('NEXT_PUBLIC_OPENAI_API_KEY is not set');
  }

  const formData = new FormData();
  formData.append('file', blob, 'audio.webm');
  formData.append('model', 'whisper-1');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('OpenAI transcription failed:', err);
    throw new Error('Failed to transcribe audio');
  }

  const data = await response.json();
  return data.text ?? '';
}
