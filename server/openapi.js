'use strict';

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'LiveRun Live API',
    version: '1.8.0',
    description:
      'Read-only endpoints intended for external systems such as guard panels, ' +
      'operator displays, and JMRI integrations. ' +
      'All times use `H:MM` format (no leading zero on the hour). ' +
      'WebSocket station feed: `/api/live/station-feed?id={timetableId}&station={stationName}[&direction=up|down]`.',
  },
  tags: [
    { name: 'Live API', description: 'Read-only endpoints for external systems' },
  ],
  components: {
    responses: {
      NotFound: {
        description: 'Not found',
        content: {
          'application/json': {
            schema: { type: 'object', properties: { error: { type: 'string' } } },
          },
        },
      },
    },
  },
  paths: {
    '/api/active-timetable': {
      get: {
        tags: ['Live API'],
        summary: 'Get the active timetable ID',
        description: 'Returns the ID of the timetable currently flagged as active. Use this ID with the `/live/trains` and `/live/stations` endpoints. Returns `null` if no timetable is active.',
        responses: {
          200: {
            description: 'Active timetable ID',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid', nullable: true, example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/timetables/{id}/live/trains': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' }, description: 'Timetable ID' },
      ],
      get: {
        tags: ['Live API'],
        summary: 'List all trains',
        description: 'Returns all trains sorted by start time.',
        responses: {
          200: {
            description: 'Train list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    trains: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string', example: 'K351' },
                          trainId: { type: 'string', example: 'CityRail 51L', description: 'Roster/JMRI ID' },
                          direction: { type: 'string', example: 'Down' },
                          notes: { type: 'string' },
                          nextCrewService: {
                            type: 'string',
                            example: 'K352',
                            description: 'Name of the next train this crew member works after this one, if assigned',
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/timetables/{id}/live/trains/{trainName}': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' }, description: 'Timetable ID' },
        { name: 'trainName', in: 'path', required: true, schema: { type: 'string' }, description: 'Train display name, e.g. `K351`' },
      ],
      get: {
        tags: ['Live API'],
        summary: 'Get a single train timetable',
        description: 'Returns the full stop-by-stop timetable for one train.',
        responses: {
          200: {
            description: 'Train timetable',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', example: 'K351' },
                    trainId: { type: 'string', example: 'CityRail 51L' },
                    direction: { type: 'string', example: 'Down' },
                    notes: { type: 'string' },
                    nextCrewService: { type: 'string', example: 'K352' },
                    stops: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          stopName: { type: 'string', example: 'Kiama' },
                          arrival: { type: 'string', nullable: true, example: '9:05' },
                          departure: { type: 'string', nullable: true, example: '9:07' },
                          specialInstructions: { type: 'string', nullable: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/timetables/{id}/live/stations/{stationName}': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' }, description: 'Timetable ID' },
        { name: 'stationName', in: 'path', required: true, schema: { type: 'string' }, description: 'Station display name, e.g. `Kiama`' },
      ],
      get: {
        tags: ['Live API'],
        summary: 'Get station arrivals and stopping patterns',
        description: 'Returns services that call at a station. Each service includes an onward stopping pattern from the queried station only. Use `direction=up` or `direction=down` to filter; omit the query to return both directions. Direction is derived from station order (increasing station order = down, decreasing station order = up). Use `trainId` for a case-insensitive wildcard filter (`%` any sequence, `_` single character).',
        parameters: [
          {
            name: 'direction',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['up', 'down'] },
            description: 'Optional direction filter.',
          },
          {
            name: 'trainId',
            in: 'query',
            required: false,
            schema: { type: 'string', example: '%cityrail%' },
            description: 'Optional case-insensitive wildcard filter for trainId. `%` matches any sequence and `_` matches one character.',
          },
        ],
        responses: {
          200: {
            description: 'Station service board',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    stationName: { type: 'string', example: 'Kiama' },
                    direction: { type: 'string', example: 'all' },
                    trainIdFilter: { type: 'string', nullable: true, example: '%cityrail%' },
                    services: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string', example: 'K351' },
                          trainId: { type: 'string', example: 'CityRail 51L' },
                          direction: { type: 'string', example: 'Down' },
                          notes: { type: 'string' },
                          nextCrewService: { type: 'string', example: 'K352' },
                          arrival: { type: 'string', nullable: true, example: '9:05' },
                          departure: { type: 'string', nullable: true, example: '9:07' },
                          stoppingPattern: {
                            type: 'array',
                            items: {
                              type: 'object',
                              properties: {
                                stopName: { type: 'string', example: 'Werri Beach' },
                                arrival: { type: 'string', nullable: true, example: '8:55' },
                                departure: { type: 'string', nullable: true, example: '8:56' },
                                specialInstructions: { type: 'string', nullable: true },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          400: {
            description: 'Invalid query parameter',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'direction must be "up" or "down"' },
                  },
                },
              },
            },
          },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
  },
};

module.exports = spec;
