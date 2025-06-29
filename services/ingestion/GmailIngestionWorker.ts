import { BaseIngestionWorker } from './BaseIngestionWorker';
import { IngestionJob, IngestionJobModel } from '../../models/IngestionJobModel';
import type { ObjectModel } from '../../models/ObjectModel';
import type { ChunkSqlModel } from '../../models/ChunkModel';
import type { LanceVectorModel } from '../../models/LanceVectorModel';
import { GmailIngestionService } from './GmailIngestionService';
import { Email } from '../../shared/types/email.types';
import { v4 as uuidv4 } from 'uuid';

export class GmailIngestionWorker extends BaseIngestionWorker {
  protected objectModel: ObjectModel;
  private gmailService: GmailIngestionService;
  private chunkModel: ChunkSqlModel;
  private vectorModel: LanceVectorModel;

  constructor(
    gmailService: GmailIngestionService,
    objectModel: ObjectModel,
    chunkModel: ChunkSqlModel,
    vectorModel: LanceVectorModel,
    ingestionJobModel: IngestionJobModel
  ) {
    super(ingestionJobModel, 'GmailIngestionWorker');
    this.gmailService = gmailService;
    this.objectModel = objectModel;
    this.chunkModel = chunkModel;
    this.vectorModel = vectorModel;
  }

  async execute(job: IngestionJob): Promise<void> {
    const { userId } = job.jobSpecificData as any;
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
      objectType: 'email',
      sourceUri: 'gmail:' + email.id,
      title: email.subject,
      status: 'parsed',
      parsedContentJson: JSON.stringify(email),
      cleanedText: email.body,
      summary: email.snippet,
      parsedAt: new Date()
    } as any);
    return obj.id;
  }
}
