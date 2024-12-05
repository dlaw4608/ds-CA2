import type { DynamoDBStreamHandler } from "aws-lambda";
import { SES_EMAIL_FROM, SES_EMAIL_TO, SES_REGION } from "../env";
import { SESClient, SendEmailCommand, SendEmailCommandInput } from "@aws-sdk/client-ses";

const client = new SESClient({ region: SES_REGION });

export const handler: DynamoDBStreamHandler = async (event) => {
  console.log("DynamoDB Stream Event:", JSON.stringify(event));

  for (const record of event.Records) {
    // Check if the event is an INSERT and `dynamodb` exists
    if (record.eventName === "INSERT" && record.dynamodb?.NewImage) {
      const newImage = record.dynamodb.NewImage;
      const imageName = newImage.ImageName?.S; // Get the image name

      if (!newImage || !newImage.ImageName || !newImage.ImageName.S) {
        console.warn("Image name is missing in the DynamoDB record.");
        continue;
      }

      const message = `A new image has been uploaded: ${imageName}`;
      const params: SendEmailCommandInput = {
        Destination: { ToAddresses: [SES_EMAIL_TO] },
        Message: {
          Body: {
            Text: { Data: message },
          },
          Subject: { Data: "New Image Uploaded" },
        },
        Source: SES_EMAIL_FROM,
      };

      try {
        await client.send(new SendEmailCommand(params));
        console.log(`Email sent for image: ${imageName}`);
      } catch (error) {
        console.error("Error sending email:", error);
      }
    } else {
      console.warn(
        `Skipped record: either not an INSERT event or missing required fields. Record: ${JSON.stringify(
          record
        )}`
      );
    }
  }
};

