import { BaseIngestionWorker } from './BaseIngestionWorker';
import { GmailIngestionService } from './GmailIngestionService';
import { ObjectModel } from '../../models/ObjectModel';
import { ChunkSqlModel } from '../../models/ChunkModel';
import { LanceVectorModel } from '../../models/LanceVectorModel';
import { Email } from '../../shared/types';
import { IngestionJob, IngestionJobModel } from '../../models/IngestionJobModel';

export interface GmailIngestionJob extends IngestionJob {
  data: { userId: string; syncType?: 'recent' | 'since' };
}

export class GmailIngestionWorker extends BaseIngestionWorker {
  protected objectModel: ObjectModel;

  constructor(
    private gmailService: GmailIngestionService,
    objectModel: ObjectModel,
    private chunkModel: ChunkSqlModel,
    private vectorModel: LanceVectorModel,
    ingestionJobModel: IngestionJobModel
  ) {
    super(ingestionJobModel, 'GmailIngestionWorker');
    this.objectModel = objectModel;
  }

  async execute(job: GmailIngestionJob): Promise<void> {
    const { userId } = job.data;
    const emails = await this.gmailService.fetchRecentEmails(userId);
    for (const email of emails) {
      await this.createEmailObject(email);
    }
  }

  private async createEmailObject(email: Email): Promise<string> {
    const obj = await this.objectModel.create({
      objectType: 'email',
      sourceUri: `gmail:${email.id}`,
      title: email.subject,
      status: 'parsed',
      rawContentRef: null,
      parsedContentJson: null,
      cleanedText: email.body,
      errorInfo: null
    });
    return obj.id;
  }
}
