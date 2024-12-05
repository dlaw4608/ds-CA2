import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as events from "aws-cdk-lib/aws-lambda-event-sources";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';


import { Construct } from "constructs";
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class EDAAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

  const imageTable = new dynamodb.Table(this,"ImageTable",
    {
       partitionKey: {
        name: "ImageName",
         type: dynamodb.AttributeType.STRING
       },
       stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES
    }
   )
    const imagesBucket = new s3.Bucket(this, "images", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
    });


     // Create a dead letter queue
     const deadLetterQueue = new sqs.Queue(this, 'dead-letter-queue', {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
    });

    
     // Integration infrastructure

     const imageProcessQueue = new sqs.Queue(this, "img-created-queue", {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
      // Set up DLQ Queue
      deadLetterQueue: {
        queue: deadLetterQueue,
        maxReceiveCount: 1,
      },
    });

    const newImageTopic = new sns.Topic(this, "NewImageTopic", {
      displayName: "New Image topic",
    }); 

   
  
  // Lambda functions

  const processImageFn = new lambdanode.NodejsFunction(
    this,
    "ProcessImageFn",
    {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/processImage.ts`,
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      environment: {
        DLQ_URL: deadLetterQueue.queueUrl,
        TABLE_NAME: imageTable.tableName
      }

    }
  );

  const mailerFn = new lambdanode.NodejsFunction(this, "mailer-function", {
    runtime: lambda.Runtime.NODEJS_18_X,
    memorySize: 1024,
    timeout: cdk.Duration.seconds(3),
    entry: `${__dirname}/../lambdas/mailer.ts`,
  });

  const rejectMailerFn = new lambdanode.NodejsFunction(this, 'reject-mailer-function', {
    runtime: lambda.Runtime.NODEJS_18_X,
    memorySize: 1024,
    timeout: cdk.Duration.seconds(3),
    entry: `${__dirname}/../lambdas/rejectMailer.ts`,
  })

  const confirmMailerFn = new lambdanode.NodejsFunction(this, 'confirm-mailer-function', {
    runtime: lambda.Runtime.NODEJS_18_X,
    memorySize: 1024,
    timeout: cdk.Duration.seconds(20),
    entry: `${__dirname}/../lambdas/confirmMailer.ts`,
  })

  const updateTableFn = new lambdanode.NodejsFunction(
    this,
    "UpdateTableFn",
    {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/updateTable.ts`,
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      environment: {
        TABLE_NAME: imageTable.tableName
      }
    }
  );
  

     // S3 --> SQS
     imagesBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SnsDestination(newImageTopic)
    );
    
    imagesBucket.addEventNotification(
      s3.EventType.OBJECT_REMOVED,
      new s3n.SnsDestination(newImageTopic)
    );

    newImageTopic.addSubscription(
      new subs.LambdaSubscription(mailerFn, {
        filterPolicyWithMessageBody: {
          Records: sns.FilterOrPolicy.policy({
            eventName: sns.FilterOrPolicy.filter(sns.SubscriptionFilter.stringFilter({
              allowlist: ["ObjectCreated:Put"],
            })),
          })
        }
      })
    );
    
    
    newImageTopic.addSubscription(
      new subs.SqsSubscription(imageProcessQueue, {
        filterPolicyWithMessageBody: {
          Records: sns.FilterOrPolicy.policy({
            eventName: sns.FilterOrPolicy.filter(sns.SubscriptionFilter.stringFilter({
              allowlist: ["ObjectCreated:Put","ObjectRemoved:Delete"],
            })),
          })
        }
      })
    )

    newImageTopic.addSubscription(
      new subs.LambdaSubscription(updateTableFn, {
        filterPolicy: {
          metadata_type: sns.SubscriptionFilter.stringFilter({
            allowlist: ["Caption", "Date", "Photographer"]
          })
        }
      })
    );
 
 // SQS --> Lambda
  const newImageEventSource = new events.SqsEventSource(imageProcessQueue, {
    batchSize: 5,
    maxBatchingWindow: cdk.Duration.seconds(5),
  });

  const newImageEventSourceDLQ = new events.SqsEventSource(deadLetterQueue, {
    batchSize: 5,
    maxBatchingWindow: cdk.Duration.seconds(5),
  });

 /* confirmMailerFn.addEventSource(
    new DynamoEventSource(imageTable, {
      startingPosition: StartingPosition.LATEST, // Process new items
    })
  );
*/
  processImageFn.addEventSource(newImageEventSource);
  rejectMailerFn.addEventSource(newImageEventSourceDLQ)
  confirmMailerFn.addEventSource(
    new events.DynamoEventSource(imageTable, {
      startingPosition: lambda.StartingPosition.LATEST,  
      retryAttempts: 10
    })
  );

  // Permissions

  imagesBucket.grantRead(processImageFn);
  imageTable.grantReadWriteData(processImageFn);
  imageTable.grantReadWriteData(updateTableFn);
  imageTable.grantStreamRead(confirmMailerFn);

  mailerFn.addToRolePolicy(
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "ses:SendEmail",
        "ses:SendRawEmail",
        "ses:SendTemplatedEmail",
      ],
      resources: ["*"],
    })
  );

  rejectMailerFn.addToRolePolicy(
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "ses:SendEmail",
        "ses:SendRawEmail",
        "ses:SendTemplatedEmail",
      ],
      resources: ["*"],
    })
  );

  processImageFn.addToRolePolicy(
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "sqs:sendmessage"
      ],
      resources: ["*"],
    })
  )


  confirmMailerFn.addToRolePolicy(
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "ses:SendEmail",
        "ses:SendRawEmail",
        "ses:SendTemplatedEmail",
      ],
      resources: ["*"],
    })
  );
  
  // Output
  
  new cdk.CfnOutput(this, "bucketName", {
    value: imagesBucket.bucketName,
  });
  }

}
