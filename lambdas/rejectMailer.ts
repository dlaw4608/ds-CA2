import { SQSHandler } from "aws-lambda";
import { SES_EMAIL_FROM, SES_EMAIL_TO, SES_REGION } from "../env";
import {
  SESClient,
  SendEmailCommand,
  SendEmailCommandInput,
} from "@aws-sdk/client-ses";

if (!SES_EMAIL_TO || !SES_EMAIL_FROM || !SES_REGION) {
  throw new Error(
    "Please add the SES_EMAIL_TO, SES_EMAIL_FROM and SES_REGION environment variables in an env.js file located in the root directory"
  );
}

type ContactDetails = {
  name: string;
  email: string;
  message: string;
};

const client = new SESClient({ region: SES_REGION });

export const handler: SQSHandler = async (event: any) => {
  for (const record of event.Records) {
    try {
      const recordBody = JSON.parse(record.body);
      // Object key may have spaces or unicode non-ASCII characters.
      const srcKey = decodeURIComponent(recordBody.srcKey);
      try {
        const { name, email, message }: ContactDetails = {
          name: "ERROR - Bad Image",
          email: SES_EMAIL_FROM,
          message: `Image Upload failed. Please try again with valid image types (jpeg, png). As the image ${srcKey} is not supported.`,
        };
        const params = sendEmailParams({ name, email, message });
        await client.send(new SendEmailCommand(params));
      } catch (error) {
        console.error("Failure processing SNS message ", error);
      }
    } catch (error) {
      console.error("Error parsing record body ", error);
    }
  }
};

function sendEmailParams({ name, email, message }: ContactDetails) {
  const parameters: SendEmailCommandInput = {
    Destination: {
      ToAddresses: [SES_EMAIL_TO],
    },
    Message: {
      Body: {
        Html: {
          Charset: "UTF-8",
          Data: getHtmlContent({ name, email, message }),
        },
      },
      Subject: {
        Charset: "UTF-8",
        Data: `No New image Upload - Error`,
      },
    },
    Source: SES_EMAIL_FROM,
  };
  return parameters;
}

function getHtmlContent({ name, email, message }: ContactDetails) {
  return `
    <html>
      <body>
        <h2>Sent from: </h2>
        <ul>
          <li style="font-size:18px">👤 <b>${name}</b></li>
          <li style="font-size:18px">✉️ <b>${email}</b></li>
        </ul>
        <p style="font-size:18px">${message}</p>
      </body>
    </html> 
  `;
}

