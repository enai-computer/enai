import { BaseIngestionWorker } from './BaseIngestionWorker';
import { IngestionJob, IngestionJobModel } from '../../models/IngestionJobModel';
import { GmailIngestionService } from './GmailIngestionService';
import { ObjectModel } from '../../models/ObjectModel';
import { ChunkSqlModel as ChunkModel } from '../../models/ChunkModel';
import { LanceVectorModel } from '../../models/LanceVectorModel';
import { Email } from '../../shared/types';
import { getGmailJobData } from './types';
import { v4 as uuidv4 } from 'uuid';

export class GmailIngestionWorker extends BaseIngestionWorker {
  constructor(
    private gmailService: GmailIngestionService,
    private objectModel: ObjectModel,
    private chunkModel: ChunkModel,
    private vectorModel: LanceVectorModel,
    ingestionJobModel: IngestionJobModel
  ) {
    super(ingestionJobModel, 'GmailIngestionWorker');
  }

  async execute(job: IngestionJob): Promise<void> {
    const { userId, syncType } = getGmailJobData(job.jobSpecificData);
    const emails = await this.gmailService.fetchRecentEmails(userId);
    for (const email of emails) {
      const objectId = await this.createEmailObject(email);
      await this.vectorModel.upsert({
        id: uuidv4(),
        objectId,
        layer: 'wom',
        recordType: 'object',
        mediaType: 'email',
        processingDepth: 'summary',
        content: email.subject + '\n' + email.snippet,
        metadata: {
          subject: email.subject,
          from: email.from.email,
          receivedAt: email.receivedAt
        }
      });
    }
  }

  private async createEmailObject(email: Email): Promise<string> {
    const obj = await this.objectModel.create({
      objectType: 'email' as any,
      sourceUri: `gmail:${email.id}`,
      title: email.subject,
      status: 'parsed',
      rawContentRef: null,
      parsedContentJson: null,
      cleanedText: email.body,
      errorInfo: null,
      parsedAt: email.receivedAt,
      fileHash: null,
      originalFileName: null,
      fileSizeBytes: null,
      fileMimeType: null,
      internalFilePath: null,
      aiGeneratedMetadata: JSON.stringify({
        from: email.from,
        to: email.to,
        cc: email.cc,
        bcc: email.bcc,
        threadId: email.threadId,
        labels: email.labels
      }),
      summary: null,
      propositionsJson: null,
      tagsJson: null,
      summaryGeneratedAt: null,
      lastAccessedAt: email.receivedAt,
      childObjectIds: null
    });
    return obj.id;
  }
}
