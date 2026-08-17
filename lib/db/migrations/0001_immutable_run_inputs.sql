CREATE TRIGGER `analysis_runs_immutable_input_update`
BEFORE UPDATE OF
  `review_id`,
  `kind`,
  `image_revision_id`,
  `selected_design_analysis_id`,
  `input_snapshot_json`
ON `analysis_runs`
BEGIN
  SELECT RAISE(ABORT, 'analysis run inputs are immutable');
END;
