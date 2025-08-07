import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import {Construct} from 'constructs';

export interface MessagingProps {
    visibilityTimeout?: cdk.Duration;
    maxReceiveCount?: number;
    retentionPeriod?: cdk.Duration;
}

export class MessagingConstruct extends Construct {
    public readonly processingQueue: sqs.Queue;
    public readonly deadLetterQueue: sqs.Queue;

    constructor(scope: Construct, id: string, props: MessagingProps = {}) {
        super(scope, id);

        // Dead letter queue first
        this.deadLetterQueue = new sqs.Queue(this, 'ProcessingDLQ', {
            queueName: 'clipgen-processing-dlq', retentionPeriod: props.retentionPeriod ?? cdk.Duration.days(14),
        });

        // Main processing queue
        this.processingQueue = new sqs.Queue(this, 'ProcessingQueue', {
            queueName: 'clipgen-processing',
            visibilityTimeout: props.visibilityTimeout ?? cdk.Duration.minutes(10),
            receiveMessageWaitTime: cdk.Duration.seconds(20),
            retentionPeriod: props.retentionPeriod ?? cdk.Duration.days(7),
            deadLetterQueue: {
                queue: this.deadLetterQueue, maxReceiveCount: props.maxReceiveCount ?? 3,
            },
        });
    }
}