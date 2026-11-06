import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class OlaverseApi implements ICredentialType {
	name = 'olaverseApi';

	displayName = 'Olaverse API';

	icon: Icon = { light: 'file:olaverse.svg', dark: 'file:olaverse.dark.svg' };

	documentationUrl = 'https://docs.olaverselab.com/get-started/quickstart/';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Your Olaverse API key, from https://console.olaverselab.com',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.olaverselab.com',
			description: 'Leave as is unless Olaverse gave you another address',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	// A one-word language check: proves the key works, and costs about $0.0003.
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/v1/language-id',
			method: 'POST',
			body: { text: 'hello' },
		},
	};
}
