import { DynamoDBClient, UpdateItemCommand, UpdateItemCommandOutput } from "@aws-sdk/client-dynamodb";
import { SNSHandler } from "aws-lambda";

const dynamodbClient = new DynamoDBClient();
const TABLE_NAME = process.env.TABLE_NAME;
export const handler: SNSHandler = async (event) => {
    for (const record of event.Records) {
        const message = JSON.parse(record.Sns.Message);
        const metadataType = record.Sns.MessageAttributes.metadata_type.Value;
        const updateParams = {
            TableName: TABLE_NAME,
            Key: {
                ImageName: { S: message.id }
            },
            UpdateExpression: `set ${metadataType} = :value`,
            ConditionExpression: 'attribute_exists(ImageName)',
            ExpressionAttributeValues: {
                ':value': { S: message.value }
            }
        };
        try {
            const result: UpdateItemCommandOutput = await dynamodbClient.send(new UpdateItemCommand(updateParams));
            console.log(`Successfully updated item with Id ${message.id}:`, result);
        } catch (error) {
            console.error(`Error - Failed to update item with Id ${message.id}:`, error);
        }
    }
}