import path from "node:path";
import { notarize } from "@electron/notarize";

const getNotarizeCredentials = (env) => {
  if (env.APPLE_KEYCHAIN_PROFILE) {
    return { keychainProfile: env.APPLE_KEYCHAIN_PROFILE };
  }

  if (env.APPLE_API_KEY && env.APPLE_API_ISSUER) {
    return {
      appleApiKey: env.APPLE_API_KEY,
      appleApiIssuer: env.APPLE_API_ISSUER,
    };
  }

  if (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) {
    return {
      appleId: env.APPLE_ID,
      appleIdPassword: env.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: env.APPLE_TEAM_ID,
    };
  }

  return null;
};

export default async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const credentials = getNotarizeCredentials(process.env);
  if (!credentials) {
    console.log("[Notarize] Skipping notarization because no Apple credentials were provided.");
    return;
  }

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );

  console.log(`[Notarize] Submitting ${appPath} for notarization...`);
  await notarize({
    appPath,
    ...credentials,
  });
  console.log("[Notarize] Notarization complete.");
}
