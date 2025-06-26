import { BaseService, BaseServiceDependencies } from './base/BaseService';
import { ServiceError } from './base/ServiceError';
import FormData from 'form-data';
import fetch from 'node-fetch';

interface AudioTranscriptionDeps extends BaseServiceDependencies {
  // No additional dependencies needed
}

export class AudioTranscriptionService extends BaseService<AudioTranscriptionDeps> {
  private readonly apiKey: string;
  private readonly MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB (Whisper limit)
  
  constructor(deps: AudioTranscriptionDeps) {
    super('AudioTranscriptionService', deps);
    
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new ServiceError('OPENAI_API_KEY environment variable is not set');
    }
    this.apiKey = apiKey;
  }

  async transcribeAudio(audioData: ArrayBuffer, mimeType: string): Promise<string> {
    return this.execute('transcribeAudio', async () => {
      // Validate file size
      if (audioData.byteLength > this.MAX_FILE_SIZE) {
        throw new ServiceError(`Audio file too large: ${audioData.byteLength} bytes (max: ${this.MAX_FILE_SIZE})`);
      }

      // Convert ArrayBuffer to Buffer
      const buffer = Buffer.from(audioData);
      
      // Create form data
      const formData = new FormData();
      formData.append('file', buffer, {
        filename: 'audio.webm',
        contentType: mimeType || 'audio/webm',
      });
      formData.append('model', 'whisper-1');

      // Make API request
      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          ...formData.getHeaders(),
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logError('OpenAI transcription failed', { 
          status: response.status, 
          error: errorText 
        });
        throw new ServiceError(`Transcription failed: ${response.status}`);
      }

      const data = await response.json();
      return data.text || '';
    });
  }
}