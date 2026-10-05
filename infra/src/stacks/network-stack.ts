import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import type { Construct } from 'constructs';

export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Section 6.1: VPC layout (10.20.0.0/16 across 2 AZs in ap-south-1)
    this.vpc = new ec2.Vpc(this, 'WorkspaceVpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.20.0.0/16'),
      maxAzs: 2,
      natGateways: 2, // Prod has 1 NAT per AZ to prevent single-AZ outage stranding
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24, // 10.20.0.0/24 & 10.20.1.0/24
        },
        {
          name: 'PrivateApp',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 20, // 10.20.16.0/20 & 10.20.32.0/20
        },
        {
          name: 'PrivateData',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24, // 10.20.64.0/24 & 10.20.65.0/24 (no internet route)
        },
      ],
    });

    // Section 6.2: S3 Gateway Endpoint (free, in-region data transfers)
    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });
  }
}
