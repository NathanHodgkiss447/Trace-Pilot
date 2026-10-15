# Five-step demonstration

All records in this demo are fictional. Start the server with the instructions in the README. Substitute the actual public origin when demonstrating the deployment.

1. Query a sample incident:

   ```sh
   curl --fail http://localhost:3000/api/demo/incidents/INC-1042
   curl --fail http://localhost:3000/api/demo/example-investigation
   ```

   Explain that the second response is a hand-authored snapshot with `generatedLive: false`. A reviewer can explore both through `/docs` without an account or API token.

2. Retrieve the authenticated evidence package. Supply tokens from your shell's private environment, never literal secrets in scripts or a screen recording:

   ```sh
   curl --fail http://localhost:3000/api/incidents/INC-1042/evidence \
     -H "Authorization: Bearer $ADMIN_API_TOKEN"
   ```

   Point out stable log/deployment/runbook IDs, two repeated TypeErrors, the deployment three minutes before onset and the passing provider healthcheck. Correlation alone is not causation. The injected instruction in one log is evidence text, not a command.

3. Trigger a live investigation **only after** PostgreSQL, the OpenAI key, token boundaries and quota tests have been verified and the owner enables `ENABLE_AI_INVESTIGATIONS=true`:

   ```sh
   curl --fail http://localhost:3000/api/investigations \
     -H "Authorization: Bearer $ADMIN_API_TOKEN" \
     -H 'Content-Type: application/json' \
     --data '{"incidentId":"INC-1042"}'
   ```

   This is a paid operation. Observe the investigation UUID, schema-constrained hypotheses, confidence classes, missing evidence and human-review flag. A disabled or unconfigured server returns a clear error.

4. Retrieve the persisted investigation using the actual UUID from step 3:

   ```sh
   curl --fail "http://localhost:3000/api/investigations/$INVESTIGATION_ID" \
     -H "Authorization: Bearer $ADMIN_API_TOKEN"
   ```

   Show the PostgreSQL row, evidence snapshot and audit records. Explain that ID validation verifies citations exist, not that the hypothesis is correct.

5. Use the equivalent MCP interface:

   ```sh
   npm run demo:mcp -- get_incident_context INC-1042
   npm run demo:mcp -- get_investigation "$INVESTIGATION_ID"
   # Optional second paid analysis; consumes another daily attempt:
   npm run demo:mcp -- analyze_incident INC-1042
   ```

   The client reads its separate `MCP_BEARER_TOKEN` from the local environment or `.env`. Demonstrate initialization and tool discovery before invocation. The final tool invokes the same investigation service as REST.
