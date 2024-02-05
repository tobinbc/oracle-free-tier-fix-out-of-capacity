//@ts-check

const core = require("oci-core");
const identity = require("oci-identity");
const wr = require("oci-workrequests");
const common = require("oci-common");

const {
  CloudWatchEventsClient,
  DisableRuleCommand,
  ListRulesCommand,
} = require("@aws-sdk/client-cloudwatch-events");
const client = new CloudWatchEventsClient();

const privateKey = process.env.PRIVATE_KEY || "";
const tenancyId = process.env.TENANCY_ID || "";
const user = process.env.USER_ID || "";
const fingerprint = process.env.FINGERPRINT || "";
const subnetId = process.env.SUBNET_ID;

const provider = new common.SimpleAuthenticationDetailsProvider(
  tenancyId,
  user,
  fingerprint,
  privateKey,
  null,
  common.Region.UK_LONDON_1
);

const computeClient = new core.ComputeClient({
  authenticationDetailsProvider: provider,
});
const maxTimeInSeconds = 60 * 60; // The duration for waiter configuration before failing. Currently set to 1 hour.
const maxDelayInSeconds = 30; // The max delay for the waiter configuration. Currently set to 30 seconds

// The waiter configuration used when creating our waiters.
const waiterConfiguration = {
  terminationStrategy: new common.MaxTimeTerminationStrategy(maxTimeInSeconds),
  delayStrategy: new common.ExponentialBackoffDelayStrategy(maxDelayInSeconds),
};

async function getShape(availabilityDomain) {
  const request = {
    availabilityDomain: availabilityDomain.name,
    compartmentId: tenancyId,
  };

  const response = await computeClient.listShapes(request);

  for (let shape of response.items) {
    if (shape.shape.startsWith("VM.Standard.A1.Flex")) {
      return shape;
    }
  }

  return response.items[0];
}
const workRequestClient = new wr.WorkRequestClient({
  authenticationDetailsProvider: provider,
});

const computeWaiter = computeClient.createWaiters(
  workRequestClient,
  waiterConfiguration
);

const virtualNetworkClient = new core.VirtualNetworkClient({
  authenticationDetailsProvider: provider,
});

const virtualNetworkWaiter = virtualNetworkClient.createWaiters(
  workRequestClient,
  waiterConfiguration
);

const identityClient = new identity.IdentityClient({
  authenticationDetailsProvider: provider,
});

async function getAvailabilityDomain() {
  const request = {
    compartmentId: tenancyId,
  };

  const response = await identityClient.listAvailabilityDomains(request);
  return response.items[0];
}
async function getImage(shape) {
  const request = {
    compartmentId: tenancyId,
    shape: shape.shape,
    operatingSystem: "Canonical Ubuntu",
    operatingSystemVersion: "22.04",
  };

  const response = await computeClient.listImages(request);
  return response.items[0];
}

module.exports.handler = async () => {
  const availabilityDomain = await getAvailabilityDomain();

  const shape = await getShape(availabilityDomain);
  const image = await getImage(shape);

  const sourceDetails = {
    imageId: image.id,
    sourceType: "image",
  };

  const launchInstanceDetails = {
    compartmentId: tenancyId,
    availabilityDomain: availabilityDomain.name ? availabilityDomain.name : "",
    shape: shape.shape,
    displayName: "Free Tier Instance",
    sourceDetails: sourceDetails,
    createVnicDetails: {
      subnetId,
      assignPublicIp: true,
    },
    metadata: {
      ssh_authorized_keys: process.env.SSH_AUTHORIZED_KEYS || "",
    },
    shapeConfig: {
      ocpus: 4,
      memoryInGBs: 24,
    },
  };

  console.log(launchInstanceDetails);

  const launchInstanceRequest = {
    launchInstanceDetails: launchInstanceDetails,
  };

  const launchInstanceResponse = await computeClient.launchInstance(
    launchInstanceRequest
  );

  const getInstanceReqeust = {
    instanceId: launchInstanceResponse.instance.id,
  };

  const getInstanceResponse = await computeWaiter.forInstance(
    getInstanceReqeust,
    core.models.Instance.LifecycleState.Running
  );
  if (getInstanceResponse) {
    console.log("Instance is now running", getInstanceResponse.instance.id);
  }

  // fetch list of rules
  const rules = await client.send(
    new ListRulesCommand({
      NamePrefix: process.env.EVENT_RULE_PREFIX,
    })
  );
  if (!rules.Rules || rules.Rules.length === 0) {
    console.log("No rules found");
    return;
  }

  await client.send(new DisableRuleCommand({ Name: rules.Rules[0].Name }));
};
