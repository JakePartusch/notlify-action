import * as github from "@actions/github";
import * as core from "@actions/core";
import { $, path, cd, fs } from "zx";
import fetch, { Headers } from "node-fetch";

const CONTROL_PLANE_API =
  "https://vt2t2uctaf.execute-api.us-east-1.amazonaws.com";

interface InitiateDeploymentResponse {
  data: {
    initiateDeployment: {
      deploymentUploadLocation: string;
      id: string;
    };
  };
  errors?: {
    message: string;
  }[];
}

interface ApplicationResponse {
  data: {
    getApplication: {
      id: string;
    };
  };
  errors?: {
    message: string;
  }[];
}

interface Deployment {
  status: string;
}

interface DeploymentResponse {
  data: {
    getDeployment: {
      status: string;
    };
  };
  errors?: {
    message: string;
  }[];
}

const getDeployment = async (
  applicationId: string,
  deploymentId: string,
  apiKey: string
): Promise<Deployment> => {
  const myHeaders = new Headers();
  myHeaders.append("Content-Type", "application/json");
  myHeaders.append("Authorization", `APIKEY ${apiKey}`);
  const getDeploymentRequest = JSON.stringify({
    query:
      "query GetDeployment($input: GetDeploymentInput!) {\n  getDeployment(input: $input) {\n    commitHash\n    id\n    status\n  }\n}\n\n                                                                    \n                                                                                  \n    \n   \n \n",
    variables: {
      input: {
        applicationId,
        deploymentId,
      },
    },
  });
  const getDeploymentRequestOptins = {
    method: "POST",
    headers: myHeaders,
    body: getDeploymentRequest,
  };

  const getDeploymentResponse = await fetch(
    CONTROL_PLANE_API,
    getDeploymentRequestOptins
  );
  const deploymentResponse: DeploymentResponse =
    (await getDeploymentResponse.json()) as DeploymentResponse;
  if (deploymentResponse.errors) {
    console.error(
      `Unable to fetch deployment: ${deploymentResponse.errors?.[0]?.message}`
    );
    throw new Error("Unable to fetch deployment");
  }
  return deploymentResponse.data.getDeployment;
};

const waitForDeployment = async (
  applicationId: string,
  deploymentId: string,
  apiKey: string,
  MAX_TIMEOUT: number
) => {
  const iterations = MAX_TIMEOUT / 2;
  let dots = "...";
  process.stdout.write("Deployment pending");
  for (let i = 0; i < iterations; i++) {
    dots += ".";
    const deployment = await getDeployment(applicationId, deploymentId, apiKey);
    if (deployment.status === "COMPLETE") {
      console.log("Deployment complete!");
      return;
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 2000));
  }
  core.setFailed(`Timeout reached: Unable to find status of ${deploymentId}`);
};

(async () => {
  const DIST_FOLDER = core.getInput("distributionDirectory");
  const APP_NAME = core.getInput("applicationName");
  const API_KEY = core.getInput("apiKey");
  const hash = github.context.sha;

  const rootDir = $.cwd ?? "./";
  const zipLocation = path.join(rootDir, `${hash}.zip`);
  const distLocation = path.join(rootDir, DIST_FOLDER);
  cd(distLocation);
  await $`zip -r ${zipLocation} *`;
  cd(rootDir);

  const myHeaders = new Headers();
  myHeaders.append("Content-Type", "application/json");
  myHeaders.append("Authorization", `APIKEY ${API_KEY}`);

  const graphql = JSON.stringify({
    query:
      "mutation InitiateDeployment($input: InitiateDeploymentInput!) {\n  initiateDeployment(input: $input) {\n    commitHash\n    deploymentUploadLocation\n    id\n    status\n  }\n}",
    variables: { input: { applicationName: APP_NAME, commitHash: `${hash}` } },
  });
  const requestOptions = {
    method: "POST",
    headers: myHeaders,
    body: graphql,
  };

  const graphqlResponse = await fetch(CONTROL_PLANE_API, requestOptions);
  const result: InitiateDeploymentResponse =
    (await graphqlResponse.json()) as InitiateDeploymentResponse;
  if (result.errors) {
    console.error(
      `Unable to initiate deployment: ${result.errors?.[0]?.message}`
    );
    throw new Error("Unable to initiate deployment");
  }
  console.log("Deployment started");
  const presignedUrl = result.data.initiateDeployment.deploymentUploadLocation;

  const file = await fs.readFileSync(path.join(rootDir, `${hash}.zip`));
  console.log("Uploading files");
  await fetch(presignedUrl, {
    method: "PUT",
    body: file,
  });
  const getApplicationByNameRequest = JSON.stringify({
    query:
      "query getApplication($input: ApplicationQueryInput!) {\n  getApplication(input: $input) {\n    customerId\n    id\n    name\n    region\n  }\n}\n\n                                                                    \n                                                                                  \n    \n   \n \n",
    variables: {
      input: {
        name: APP_NAME,
      },
    },
  });
  const getApplicationByNameRequestOptions = {
    method: "POST",
    headers: myHeaders,
    body: getApplicationByNameRequest,
  };

  const getApplicationByNameResponse = await fetch(
    CONTROL_PLANE_API,
    getApplicationByNameRequestOptions
  );
  const applicationResponse: ApplicationResponse =
    (await getApplicationByNameResponse.json()) as ApplicationResponse;

  if (result.errors) {
    console.error(
      `Unable to fetch application: ${applicationResponse.errors?.[0]?.message}`
    );
    throw new Error("Unable to fetch application");
  }
  await waitForDeployment(
    applicationResponse.data.getApplication.id,
    result.data.initiateDeployment.id,
    API_KEY,
    60 * 10
  );
})();
