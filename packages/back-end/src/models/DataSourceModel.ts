import mongoose from "mongoose";
import {
  DataSourceInterface,
  DataSourceParams,
  DataSourceSettings,
  DataSourceType,
} from "../../types/datasource";
import { GoogleAnalyticsParams } from "../../types/integrations/googleanalytics";
import { getOauth2Client } from "../integrations/GoogleAnalytics";
import {
  encryptParams,
  testDataSourceConnection,
} from "../services/datasource";
import uniqid from "uniqid";
import { usingFileConfig, getConfigDatasources } from "../init/config";

const dataSourceSchema = new mongoose.Schema({
  id: String,
  name: String,
  organization: {
    type: String,
    index: true,
  },
  dateCreated: Date,
  dateUpdated: Date,
  type: { type: String },
  params: String,
  settings: {},
});
dataSourceSchema.index({ id: 1, organization: 1 }, { unique: true });
type DataSourceDocument = mongoose.Document & DataSourceInterface;

const DataSourceModel = mongoose.model<DataSourceDocument>(
  "DataSource",
  dataSourceSchema
);

function toInterface(doc: DataSourceDocument): DataSourceInterface {
  return upgradeDatasourceObject(doc.toJSON());
}
export function upgradeDatasourceObject(
  datasource: DataSourceInterface
): DataSourceInterface {
  const settings = datasource.settings;

  if (!settings?.ids) {
    settings.ids = [
      {
        id: "user_id",
        description: "Logged-in user id",
      },
      {
        id: "anonymous_id",
        description: "Anonymous visitor id",
      },
    ];
  }
  if (settings?.queries?.experimentsQuery && !settings?.queries?.exposure) {
    settings.queries.exposure = {
      main: {
        description: "Main experiment exposures table",
        dimensions: datasource.settings.experimentDimensions || [],
        ids: ["user_id", "anonymous_id"],
        query: settings.queries.experimentsQuery,
      },
    };
  }

  return datasource;
}

export async function getDataSourcesByOrganization(organization: string) {
  // If using config.yml, immediately return the list from there
  if (usingFileConfig()) {
    return getConfigDatasources(organization);
  }

  return (
    await DataSourceModel.find({
      organization,
    })
  ).map(toInterface);
}
export async function getDataSourceById(id: string, organization: string) {
  // If using config.yml, immediately return the from there
  if (usingFileConfig()) {
    return (
      getConfigDatasources(organization).filter((d) => d.id === id)[0] || null
    );
  }

  const doc = await DataSourceModel.findOne({
    id,
    organization,
  });

  return doc ? toInterface(doc) : null;
}

export async function getOrganizationsWithDatasources(): Promise<string[]> {
  if (usingFileConfig()) {
    return [];
  }
  return await DataSourceModel.distinct("organization");
}
export async function deleteDatasourceById(id: string, organization: string) {
  if (usingFileConfig()) {
    throw new Error("Cannot delete. Data sources managed by config.yml");
  }
  await DataSourceModel.deleteOne({
    id,
    organization,
  });
}

export async function createDataSource(
  organization: string,
  name: string,
  type: DataSourceType,
  params: DataSourceParams,
  settings: DataSourceSettings,
  id?: string
) {
  if (usingFileConfig()) {
    throw new Error("Cannot add. Data sources managed by config.yml");
  }

  id = id || uniqid("ds_");

  if (type === "google_analytics") {
    const oauth2Client = getOauth2Client();
    const { tokens } = await oauth2Client.getToken(
      (params as GoogleAnalyticsParams).refreshToken
    );
    (params as GoogleAnalyticsParams).refreshToken = tokens.refresh_token || "";
  }

  const datasource: DataSourceInterface = {
    id,
    name,
    organization,
    type,
    settings,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    params: encryptParams(params),
  };

  // Test the connection and create in the database
  await testDataSourceConnection(datasource);
  const model = await DataSourceModel.create(datasource);

  return toInterface(model);
}

export async function updateDataSource(
  id: string,
  organization: string,
  updates: Partial<DataSourceInterface>
) {
  if (usingFileConfig()) {
    throw new Error("Cannot update. Data sources managed by config.yml");
  }

  await DataSourceModel.updateOne(
    {
      id,
      organization,
    },
    {
      $set: updates,
    }
  );
}
