import { BaseIngestionWorker } from './BaseIngestionWorker';
import { IngestionJob } from '../../models/IngestionJobModel';
import { GmailIngestionService } from './GmailIngestionService';
import { ObjectModel } from '../../models/ObjectModel';
import { ChunkSqlModel } from '../../models/ChunkModel';
import { LanceVectorModel } from '../../models/LanceVectorModel';
import { Email } from '../../shared/types';
import { v4 as uuidv4 } from 'uuid';

export class GmailIngestionWorker extends BaseIngestionWorker {
  protected objectModel: ObjectModel;

  constructor(
    private gmailService: GmailIngestionService,
    objectModel: ObjectModel,
    private chunkModel: ChunkSqlModel,
    private vectorModel: LanceVectorModel,
    ingestionJobModel: any
  ) {
    super(ingestionJobModel, 'GmailIngestionWorker');
    this.objectModel = objectModel;
  }

  async execute(job: IngestionJob): Promise<void> {
    const { userId } = job.jobSpecificData || {};
    if (!userId) return;
    const emails = await this.gmailService.fetchRecentEmails(userId);
    for (const email of emails) {
      await this.createEmailObject(email);
    }
  }

  private async createEmailObject(email: Email): Promise<string> {
    const obj = await this.objectModel.create({
      objectType: 'email',
      sourceUri: null,
      title: email.subject,
      status: 'parsed',
      rawContentRef: null,
      parsedContentJson: null,
      cleanedText: email.body,
      errorInfo: null,
      parsedAt: email.receivedAt,
      summary: null,
      propositionsJson: null,
      tagsJson: null,
      summaryGeneratedAt: null
    });

    await this.vectorModel.addDocumentsWithText(
      [`${email.subject}\n${email.snippet}`],
      [{
        id: uuidv4(),
        objectId: obj.id,
        layer: 'wom',
        recordType: 'object',
        mediaType: 'email',
        processingDepth: 'summary',
        createdAt: Date.now(),
        title: email.subject,
        summary: '',
        sourceUri: '',
        tags: [],
        propositions: [],
      }]
    );
    return obj.id;
  }
}
