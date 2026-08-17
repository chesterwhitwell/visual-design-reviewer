import type { AppDatabase } from "../client";
import { getDatabase } from "../client";
import { AnalysisArtifactRepository } from "./artifacts";
import { AnalysisRunRepository } from "./analysis-runs";
import { CriteriaSetRepository } from "./criteria-sets";
import { ReviewRepository } from "./reviews";
import type { RepositoryDependencies } from "./shared";
import { SettingsRepository } from "./settings";

export * from "./analysis-runs";
export * from "./artifacts";
export * from "./criteria-sets";
export * from "./errors";
export * from "./reviews";
export * from "./settings";

export interface Repositories {
  reviews: ReviewRepository;
  analysisRuns: AnalysisRunRepository;
  analysisArtifacts: AnalysisArtifactRepository;
  criteriaSets: CriteriaSetRepository;
  settings: SettingsRepository;
}

export function createRepositories(
  db: AppDatabase = getDatabase(),
  dependencies: RepositoryDependencies = {},
): Repositories {
  return {
    reviews: new ReviewRepository(db, dependencies),
    analysisRuns: new AnalysisRunRepository(db, dependencies),
    analysisArtifacts: new AnalysisArtifactRepository(db, dependencies),
    criteriaSets: new CriteriaSetRepository(db, dependencies),
    settings: new SettingsRepository(db, dependencies),
  };
}
