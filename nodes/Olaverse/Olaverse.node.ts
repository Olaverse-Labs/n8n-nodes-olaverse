import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError, sleep } from 'n8n-workflow';

// Programmatic rather than declarative: extraction can read an image from a previous node's binary data, and a long
// document becomes an asynchronous job that this node creates and then polls until it's done.

const PLAIN_LIMIT = 60_000; // characters /v1/extract takes in one call; longer text runs as a job
const IMAGE_TYPES = ['image/jpeg', 'image/png'];

const DIACRITIC_LANGUAGES = [
	{ name: 'Arabic', value: 'ara' },
	{ name: 'French', value: 'fra' },
	{ name: 'Hausa', value: 'hau' },
	{ name: 'Igbo', value: 'ibo' },
	{ name: 'Italian', value: 'ita' },
	{ name: 'Polish', value: 'pol' },
	{ name: 'Portuguese', value: 'por' },
	{ name: 'Spanish', value: 'spa' },
	{ name: 'Turkish', value: 'tur' },
	{ name: 'Vietnamese', value: 'vie' },
	{ name: 'Yorùbá', value: 'yor' },
];

export class Olaverse implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Olaverse',
		name: 'olaverse',
		icon: { light: 'file:olaverse.svg', dark: 'file:olaverse.dark.svg' },
		group: ['transform'],
		version: [1],
		subtitle: '={{$parameter["operation"]}}',
		description:
			'Document extraction with calibrated confidence, decisions, language ID in 608 languages, diacritics and question generation in 324 languages',
		defaults: {
			name: 'Olaverse',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'olaverseApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Document', value: 'document' },
					{ name: 'Text', value: 'text' },
				],
				default: 'document',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['document'] } },
				options: [
					{
						name: 'Extract',
						value: 'extract',
						description:
							'Turn a document (text or an image) into JSON from a template, with a confidence for every field',
						action: 'Extract fields from a document',
					},
				],
				default: 'extract',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['text'] } },
				options: [
					{
						name: 'Decide',
						value: 'decide',
						description:
							'Answer typed questions about a message or record, with a calibrated probability for every answer',
						action: 'Decide about a message',
					},
					{
						name: 'Detect Language',
						value: 'detectLanguage',
						description: 'Identify the language of a text among 608 languages',
						action: 'Detect the language of a text',
					},
					{
						name: 'Generate Questions',
						value: 'generateQuestions',
						description: 'Write the questions a passage answers, in its own language or another (324 languages)',
						action: 'Generate questions from a passage',
					},
					{
						name: 'Restore Diacritics',
						value: 'restoreDiacritics',
						description: 'Put back tone marks, accents and Arabic vowel marks',
						action: 'Restore diacritics in a text',
					},
				],
				default: 'decide',
			},

			// ---- Document: Extract ----
			{
				displayName: 'Template',
				name: 'template',
				type: 'json',
				required: true,
				default:
					'{\n  "merchant": "verbatim-string",\n  "date": "date",\n  "total": "number",\n  "items": [{"name": "verbatim-string", "price": "number"}]\n}',
				description:
					'The shape of the answer. Each leaf names a type: verbatim-string, string, number, integer, date, date-time, boolean, ["a", "b"] (pick one), ["string"] (a list) or [{...}] (a list of objects).',
				displayOptions: { show: { resource: ['document'], operation: ['extract'] } },
			},
			{
				displayName: 'Input',
				name: 'input',
				type: 'options',
				options: [
					{ name: 'Text', value: 'text', description: 'The document as text' },
					{
						name: 'Image (Binary)',
						value: 'image',
						description: 'A JPEG or PNG from a previous node, such as an email attachment',
					},
				],
				default: 'text',
				displayOptions: { show: { resource: ['document'], operation: ['extract'] } },
			},
			{
				displayName: 'Text',
				name: 'documentText',
				type: 'string',
				typeOptions: { rows: 6 },
				required: true,
				default: '',
				description:
					'The document as text. Over 60,000 characters it runs as a long-document job: split, extracted in parallel and merged.',
				displayOptions: { show: { resource: ['document'], operation: ['extract'], input: ['text'] } },
			},
			{
				displayName: 'Input Binary Field',
				name: 'binaryPropertyName',
				type: 'string',
				required: true,
				default: 'data',
				description: 'The name of the binary field holding the image',
				displayOptions: { show: { resource: ['document'], operation: ['extract'], input: ['image'] } },
			},
			{
				displayName: 'Options',
				name: 'extractOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['document'], operation: ['extract'] } },
				options: [
					{
						displayName: 'Instructions',
						name: 'instructions',
						type: 'string',
						default: '',
						placeholder: 'Dates are day/month/year',
						description: 'Optional guidance for the model',
					},
					{
						displayName: 'Max Wait for Long Documents (Seconds)',
						name: 'maxWait',
						type: 'number',
						typeOptions: { minValue: 30 },
						default: 900,
						description:
							'How long to wait for a long-document job before returning its ID (and status "running") instead of the result',
					},
				],
			},

			// ---- Text: Decide ----
			{
				displayName: 'State',
				name: 'state',
				type: 'string',
				typeOptions: { rows: 4 },
				required: true,
				default: '',
				placeholder: 'I was charged twice, please refund me',
				description: 'The message, ticket or record to decide about. A JSON object is sent as a structured record.',
				displayOptions: { show: { resource: ['text'], operation: ['decide'] } },
			},
			{
				displayName: 'Questions',
				name: 'questions',
				type: 'json',
				required: true,
				default:
					'{\n  "refund": {"type": "noul", "instructions": "The customer is asking for money back."},\n  "team": {"type": "choice", "instructions": "Which team should handle this?", "criteria": {"billing": "payments and refunds", "delivery": "orders in transit"}},\n  "urgency": {"type": "score", "instructions": "How urgent is this?", "criteria": ["can wait", "today", "immediately"]}\n}',
				description:
					'Typed questions: noul (is this true?), choice (pick one of named options) or score (an ordered scale)',
				displayOptions: { show: { resource: ['text'], operation: ['decide'] } },
			},

			// ---- Text: Detect Language / Restore Diacritics / Generate Questions ----
			{
				displayName: 'Text',
				name: 'text',
				type: 'string',
				typeOptions: { rows: 3 },
				required: true,
				default: '',
				displayOptions: {
					show: { resource: ['text'], operation: ['detectLanguage', 'restoreDiacritics', 'generateQuestions'] },
				},
			},
			{
				displayName: 'Mode',
				name: 'mode',
				type: 'options',
				options: [
					{
						name: 'Traffic',
						value: 'traffic',
						description: 'User messages and chat: favours languages people actually use',
					},
					{ name: 'Coverage', value: 'coverage', description: 'Every language equal, for building corpora' },
				],
				default: 'traffic',
				displayOptions: { show: { resource: ['text'], operation: ['detectLanguage'] } },
			},
			{
				displayName: 'Language',
				name: 'language',
				type: 'options',
				options: DIACRITIC_LANGUAGES,
				default: 'yor',
				displayOptions: { show: { resource: ['text'], operation: ['restoreDiacritics'] } },
			},
			{
				displayName: 'Let the Model Decide How Many',
				name: 'autoCount',
				type: 'boolean',
				default: false,
				description: 'Whether to let the model write as many questions as the passage supports, instead of a set number',
				displayOptions: { show: { resource: ['text'], operation: ['generateQuestions'] } },
			},
			{
				displayName: 'Number of Questions',
				name: 'n',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 5 },
				default: 3,
				description: 'In the passage’s own language this is a maximum; across languages you get exactly this many',
				displayOptions: { show: { resource: ['text'], operation: ['generateQuestions'], autoCount: [false] } },
			},
			{
				displayName: 'Question Language',
				name: 'questionLanguage',
				type: 'string',
				default: '',
				placeholder: 'e.g. English, French, Swahili',
				description:
					'Leave empty for the passage’s own language. English or French work for any passage; Spanish, Hindi, Chinese, Swahili, Yoruba, Amharic and 24 more work from an English or French passage.',
				displayOptions: { show: { resource: ['text'], operation: ['generateQuestions'] } },
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const credentials = await this.getCredentials('olaverseApi');
		const baseURL = String(credentials.baseUrl || 'https://api.olaverselab.com').replace(/\/+$/, '');

		const call = async (method: IHttpRequestMethods, path: string, body?: IDataObject) =>
			(await this.helpers.httpRequestWithAuthentication.call(this, 'olaverseApi', {
				method,
				baseURL,
				url: path,
				body,
				json: true,
				timeout: 240_000,
			})) as IDataObject;

		const parseJson = (value: unknown, name: string, itemIndex: number): IDataObject => {
			if (typeof value === 'object' && value !== null) return value as IDataObject;
			try {
				return JSON.parse(String(value)) as IDataObject;
			} catch {
				throw new NodeOperationError(this.getNode(), `'${name}' must be valid JSON`, { itemIndex });
			}
		};

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				let response: IDataObject;

				if (resource === 'document' && operation === 'extract') {
					const template = parseJson(this.getNodeParameter('template', i), 'Template', i);
					const input = this.getNodeParameter('input', i) as string;
					const options = this.getNodeParameter('extractOptions', i, {}) as IDataObject;
					const body: IDataObject = { template };
					if (options.instructions) body.instructions = options.instructions;

					if (input === 'image') {
						const field = this.getNodeParameter('binaryPropertyName', i) as string;
						const binary = this.helpers.assertBinaryData(i, field);
						if (!IMAGE_TYPES.includes(binary.mimeType)) {
							throw new NodeOperationError(
								this.getNode(),
								`The binary field '${field}' is ${binary.mimeType}; send a JPEG or PNG image (for a PDF, extract its text first and use the Text input)`,
								{ itemIndex: i },
							);
						}
						const buffer = await this.helpers.getBinaryDataBuffer(i, field);
						body.image = `data:${binary.mimeType};base64,${buffer.toString('base64')}`;
					} else {
						body.text = this.getNodeParameter('documentText', i) as string;
					}

					if (typeof body.text === 'string' && body.text.length > PLAIN_LIMIT) {
						const job = await call('POST', '/v1/extract/jobs', body);
						const deadline = Date.now() + Number(options.maxWait ?? 900) * 1000;
						response = job;
						while (Date.now() < deadline) {
							await sleep(5000);
							response = await call('GET', String(job.poll));
							if (response.status !== 'running') break;
						}
						if (response.status === 'failed') {
							throw new NodeOperationError(
								this.getNode(),
								`The document couldn't be extracted: ${String(response.error)}`,
								{
									itemIndex: i,
									description:
										'Check the template and the text, or send the document in smaller sections. Long documents are split into parts; this one had none that could be extracted.',
								},
							);
						}
					} else {
						response = await call('POST', '/v1/extract', body);
					}
				} else if (resource === 'text' && operation === 'decide') {
					const raw = this.getNodeParameter('state', i) as string;
					let state: string | IDataObject = raw;
					if (raw.trim().startsWith('{')) {
						try {
							state = JSON.parse(raw) as IDataObject;
						} catch {
							state = raw;
						}
					}
					const questions = parseJson(this.getNodeParameter('questions', i), 'Questions', i);
					response = await call('POST', '/v1/decide', { state, questions });
				} else if (resource === 'text' && operation === 'detectLanguage') {
					response = await call('POST', '/v1/language-id', {
						text: this.getNodeParameter('text', i) as string,
						mode: this.getNodeParameter('mode', i) as string,
					});
				} else if (resource === 'text' && operation === 'restoreDiacritics') {
					response = await call('POST', '/v1/diacritize', {
						text: this.getNodeParameter('text', i) as string,
						language: this.getNodeParameter('language', i) as string,
					});
				} else if (resource === 'text' && operation === 'generateQuestions') {
					const questionLanguage = (this.getNodeParameter('questionLanguage', i, '') as string).trim();
					response = await call('POST', '/v1/questions/generate', {
						passage: this.getNodeParameter('text', i) as string,
						n: this.getNodeParameter('autoCount', i, false)
							? 'auto'
							: (this.getNodeParameter('n', i) as number),
						...(questionLanguage ? { question_language: questionLanguage } : {}),
					});
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown operation ${resource}/${operation}`, {
						itemIndex: i,
					});
				}

				returnData.push({ json: response, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				if (error instanceof NodeOperationError) {
					throw new NodeOperationError(this.getNode(), error, { itemIndex: i });
				}
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
