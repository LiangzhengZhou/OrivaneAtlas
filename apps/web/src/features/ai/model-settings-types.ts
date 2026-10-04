import type {
  ModelConfiguration,
  ModelConfigurationInput,
} from "@arclattice/application";
export type ConfigurationChange = (
  edit: (current: ModelConfiguration) => ModelConfigurationInput,
) => Promise<boolean>;
export interface ModelSettingsSectionProps {
  configuration: ModelConfiguration;
  busy: boolean;
  zh: boolean;
  save: ConfigurationChange;
}
export function configurationInput(
  configuration: ModelConfiguration,
): ModelConfigurationInput {
  const { version: _version, ...input } = configuration;
  return { ...input, credentials: [] };
}
