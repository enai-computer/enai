import { IpcMain } from 'electron';
import { AUDIO_TRANSCRIBE } from '../../shared/ipcChannels';
import { AudioTranscribePayload, AudioTranscribeResult } from '../../shared/types/api.types';
import { AudioTranscriptionService } from '../../services/AudioTranscriptionService';
import { logger } from '../../utils/logger';

export function registerAudioHandlers(
  ipcMain: IpcMain,
  audioTranscriptionService: AudioTranscriptionService
) {
  ipcMain.handle(AUDIO_TRANSCRIBE, async (event, payload: AudioTranscribePayload): Promise<AudioTranscribeResult> => {
    logger.debug('[AudioHandler] Transcribe request received', {
      mimeType: payload.mimeType,
      size: payload.audioData.byteLength,
      duration: payload.duration,
    });

    try {
      const text = await audioTranscriptionService.transcribeAudio(
        payload.audioData,
        payload.mimeType
      );
      
      logger.info('[AudioHandler] Transcription successful', { 
        textLength: text.length 
      });
      
      return { text };
    } catch (error) {
      logger.error('[AudioHandler] Transcription failed', error);
      throw error;
    }
  });
}