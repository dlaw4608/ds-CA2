/* eslint-disable import/extensions, import/no-absolute-path */
import { SQSHandler } from "aws-lambda";
import {PutItemCommand, PutItemCommandInput, DynamoDBClient} from '@aws-sdk/client-dynamodb'
import {
  GetObjectCommand,
  PutObjectCommandInput,
  GetObjectCommandInput,
  S3Client,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

import {
  SQSClient,
  SendMessageCommand,
  SendMessageCommandInput
} from '@aws-sdk/client-sqs'

const sqs = new SQSClient();
const s3 = new S3Client();
const DLQ_URL = process.env.DLQ_URL;
const dynamodbClient = new DynamoDBClient();
const TABLE_NAME = process.env.TABLE_NAME

export const handler: SQSHandler = async (event) => {
  console.log("Event ", JSON.stringify(event));
  for (const record of event.Records) {
    const recordBody = JSON.parse(record.body);        // Parse SQS message
    const snsMessage = JSON.parse(recordBody.Message); // Parse SNS message

    if (snsMessage.Records) {
      console.log("Record body ", JSON.stringify(snsMessage));
      for (const messageRecord of snsMessage.Records) {
        const s3e = messageRecord.s3;
        const srcBucket = s3e.bucket.name;
        // Object key may have spaces or unicode non-ASCII characters.
        const srcKey = decodeURIComponent(s3e.object.key.replace(/\+/g, " "));
        let origimage = null;
        try {
          // Download the image from the S3 source bucket.
          const params: GetObjectCommandInput = {
            Bucket: srcBucket,
            Key: srcKey,
          };
          origimage = await s3.send(new GetObjectCommand(params));

          if (!srcKey.endsWith('.jpeg') && !srcKey.endsWith('.png')) {
            // pass message to dlq
            console.log(`Unsupported file type: ${srcKey}`);
            const dlqMessageParams: SendMessageCommandInput = {
              QueueUrl: DLQ_URL, 
              MessageBody: JSON.stringify({
                error: "Unsupported file type",
                srcBucket,
                srcKey,
              }),
            };
            await sqs.send(new SendMessageCommand(dlqMessageParams));
            console.log(`Message sent to DLQ for file: ${srcKey}`);
          } else {
            // Add image to DynamoDB Table if valid file type
            const imageTableRequestParams: PutItemCommandInput = {
              TableName: TABLE_NAME,
              Item: {
                ImageName: { S : srcKey }
              }
            }
            await dynamodbClient.send(new PutItemCommand(imageTableRequestParams))
            console.log(`File ${srcKey} has been added to ${TABLE_NAME}`)
          }
          // Process the image ......
        } catch (error) {
          console.log(error);
        } 
      }
    }
  }
};