import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../stacks/network-stack.js';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || '123456789012',
  region: process.env.CDK_DEFAULT_REGION || 'ap-south-1',
};

// Architecture B Stacks (Stage 23)
new NetworkStack(app, 'WorkspaceV1-NetworkStack', {
  env,
  description: 'VPC across 2 AZs with public, private-app, and private-data subnets (Section 6.1)',
});

app.synth();
