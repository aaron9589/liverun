'use strict';

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'LiveRun Live API',
    version: '2.2.0',
    description:
      'Read-only endpoints intended for external systems such as guard panels, ' +
      'operator displays, and JMRI integrations. ' +
      'All times use `H:MM` format (no leading zero on the hour). ' +
      'WebSocket station feed: `/api/live/station-feed?id={timetableId}&station={stationName}[&direction=up|down]`.',
  },
  tags: [
    { name: 'Live API', description: 'Read-only endpoints for external systems' },
    { name: 'Path requests', description: 'Crews ask Control for a path; Control acknowledges, declines or accepts it. Every call except the list is written to the audit log.' },
  ],
  components: {
    schemas: {
      PathRequest: {
        type: 'object',
        required: ['id', 'timetable_id', 'crew_id', 'stops', 'status', 'created_at', 'updated_at'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          timetable_id: { type: 'string' },
          crew_id: { type: 'string', description: 'Requesting crew' },
          loco: { type: 'string', description: 'JMRI roster name or free text' },
          stops: {
            type: 'array',
            description: 'Running order: origin, work stops, destination',
            items: {
              type: 'object',
              properties: {
                station_id: { type: 'string' },
                location_alias: { type: 'string', nullable: true, description: 'Siding/road; only where the station has alias_enabled' },
                kind: { type: 'string', enum: ['stop', 'shunt', 'work'], description: 'Origin and destination are always stop' },
                minutes: { type: 'integer', minimum: 0, maximum: 240 },
                note: { type: 'string' },
              },
            },
          },
          ready_at: { type: 'string', nullable: true, example: '14:20', description: 'Fast-clock HH:MM; null = as soon as possible' },
          notes: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'in_review', 'accepted', 'declined', 'withdrawn', 'cancelled'] },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
          control_note: { type: 'string', description: 'Control to crew; set on decline' },
          train_id_created: { type: 'string', description: 'Train.id once accepted' },
          assigned_crew_id: { type: 'string' },
          cancel_ask: {
            type: 'object',
            properties: {
              at: { type: 'string', format: 'date-time' },
              reason: { type: 'string' },
              status: { type: 'string', enum: ['open', 'rejected', 'approved'] },
              control_note: { type: 'string' },
            },
          },
        },
      },
    },
    responses: {
      NotFound: {
        description: 'Not found',
        content: {
          'application/json': {
            schema: { type: 'object', properties: { error: { type: 'string' } } },
          },
        },
      },
      WrongState: {
        description: 'The request is in the wrong state for this action (e.g. the crew withdrew it meanwhile)',
        content: {
          'application/json': {
            schema: { type: 'object', properties: { error: { type: 'string' }, status: { type: 'string', description: 'Current request status', example: 'withdrawn' } } },
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
    '/api/layout': {
      get: {
        tags: ['Layout'],
        summary: 'Get the layout-wide configuration',
        description: 'Physical-layout settings shared by every timetable (e.g. the JMRI JSON WebSocket URL). Sections not yet saved are returned with defaults.',
        responses: {
          200: {
            description: 'Layout configuration',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    jmri: {
                      type: 'object',
                      properties: {
                        url: { type: 'string', example: 'wss://jmri.example.net/json/', description: "JMRI JSON WebSocket URL ('' = not configured)" },
                      },
                    },
                    loa: {
                      type: 'object',
                      description: 'Limit of Authority: directional sections between stations, each with signal/token/condition/selector elements watching MQTT topics.',
                      properties: {
                        sections: {
                          type: 'array',
                          items: {
                            type: 'object',
                            required: ['id', 'name', 'from', 'to', 'only', 'except', 'elements'],
                            properties: {
                              id: { type: 'string', description: 'Unique, stable' },
                              name: { type: 'string' },
                              from: { type: 'string', description: 'Station name (case-insensitive)' },
                              to: { type: 'string', description: 'Station name (case-insensitive); differs from from' },
                              only: { type: 'array', items: { type: 'string' }, description: 'Globs on train_id / train name; non-empty = only these trains' },
                              except: { type: 'array', items: { type: 'string' }, description: 'Globs on train_id / train name; matching trains never get the section' },
                              elements: {
                                type: 'array',
                                items: {
                                  type: 'object',
                                  required: ['type', 'label', 'topic'],
                                  properties: {
                                    type: { type: 'string', enum: ['signal', 'token', 'condition', 'selector'] },
                                    label: { type: 'string' },
                                    topic: { type: 'string', description: 'MQTT topic, no wildcards' },
                                    clear: { type: 'array', items: { type: 'string' }, description: 'Payload globs that mean clear (conditions)' },
                                    caution: { type: 'array', items: { type: 'string' }, description: 'Payload globs that count as clear but show amber' },
                                    grants: { type: 'boolean', description: 'Must be clear for the grant. Default true' },
                                    revokes: { type: 'boolean', description: 'Going not clear releases the authority. Defaults: token true, others false' },
                                    options: { type: 'object', additionalProperties: { type: 'object' }, description: 'Selectors: payload value to condition' },
                                    default: { type: 'string', description: 'Selectors: option key used before the selector topic has a value' },
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
            },
          },
        },
      },
      put: {
        tags: ['Layout'],
        summary: 'Replace the layout-wide configuration',
        description: 'Validates and stores the layout configuration, returning the stored result with defaults applied. `jmri.url` must use ws:// or wss://.',
        responses: {
          200: { description: 'Stored layout configuration' },
          400: { description: 'Validation error' },
        },
      },
    },
    '/api/loa/values': {
      get: {
        tags: ['Layout'],
        summary: 'Get cached LOA topic values',
        description:
          'Last value and receive time of every MQTT topic referenced in `layout.loa`, from the server\'s single connection to the active timetable\'s broker (`settings.clock_broker_url`). ' +
          'Empty when there is no active timetable, no broker URL or no LOA topics. Values are dropped when the broker changes or a topic is no longer referenced. ' +
          'The live sync WebSocket (`/api/live/sync`) sends the same snapshot on connect (`loa-values`, `full: true`) and then coalesced deltas (`full: false`).',
        responses: {
          200: {
            description: 'Topic → last value',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: {
                    type: 'object',
                    properties: {
                      value: { type: 'string', description: 'Payload as text', example: 'THROWN' },
                      at: { type: 'string', format: 'date-time', description: 'When the server received it' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/sounds': {
      get: {
        tags: ['Sounds'],
        summary: 'List the sound library',
        description: 'Audio files used by train profiles and the guard alert. Seeded with default sounds on first start; stored in the data volume.',
        responses: {
          200: {
            description: 'Files sorted by name',
            content: { 'application/json': { schema: { type: 'array', items: { type: 'object', properties: { file: { type: 'string', example: 'bell.mp3' }, size: { type: 'integer', description: 'Bytes' } } } } } },
          },
        },
      },
      post: {
        tags: ['Sounds'],
        summary: 'Upload a sound',
        description: 'Raw file as the request body (Content-Type audio/* or application/octet-stream, max 2 MB). The name must be a plain file name (letters, digits, space, . _ -, max 100 chars, no leading dot) ending in .mp3, .ogg or .wav; contents are checked against the type.',
        parameters: [
          { name: 'name', in: 'query', required: true, schema: { type: 'string' }, description: 'File name to store' },
          { name: 'overwrite', in: 'query', required: false, schema: { type: 'string', enum: ['1'] }, description: 'Set to 1 to replace an existing file' },
        ],
        requestBody: { required: true, content: { 'audio/mpeg': { schema: { type: 'string', format: 'binary' } } } },
        responses: {
          201: { description: 'Stored' },
          400: { description: 'Invalid name or contents' },
          409: { description: 'File exists and overwrite was not requested' },
          413: { description: 'Larger than 2 MB' },
          415: { description: 'Unsupported Content-Type' },
        },
      },
    },
    '/api/sounds/{file}': {
      parameters: [
        { name: 'file', in: 'path', required: true, schema: { type: 'string' }, description: 'Sound file name' },
      ],
      get: {
        tags: ['Sounds'],
        summary: 'Download a sound',
        responses: {
          200: { description: 'Audio file', content: { 'audio/mpeg': { schema: { type: 'string', format: 'binary' } } } },
          400: { description: 'Invalid name' },
          404: { description: 'Not found' },
        },
      },
      delete: {
        tags: ['Sounds'],
        summary: 'Delete a sound',
        responses: {
          200: { description: 'Deleted' },
          400: { description: 'Invalid name' },
          404: { description: 'Not found' },
        },
      },
    },
    '/api/timetables/{id}/settings': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Timetable ID' },
      ],
      put: {
        tags: ['Path requests'],
        summary: 'Update timetable settings (path-request keys shown)',
        description:
          'Only the path-request keys are documented here; the same body also takes the clock keys (`clock_enabled`, `clock_broker_url`, `clock_topic`), `graph_scale` and `auto_assign_min_break`. ' +
          'Keys that are sent are validated and stored; a bad value is refused with 400 and nothing is saved. Returns the full timetable.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  requests_enabled: { type: 'boolean', description: 'Default true. Off: new submits are refused (400)' },
                  request_train_prefix: { type: 'string', pattern: '^[A-Za-z0-9-]{1,8}$', default: 'PR', description: 'Prefix for the train IDs created on accept' },
                  request_default_leg_min: { type: 'integer', minimum: 1, maximum: 120, default: 5, description: 'Minutes per leg when no path template gives a time' },
                  request_lead_min: { type: 'integer', minimum: 0, maximum: 60, default: 2, description: 'Lead time (minutes) for "as soon as possible" requests' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'The updated timetable' },
          400: { description: 'A value is out of range or malformed (see error)' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/timetables/{id}/path-requests': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Timetable ID' },
      ],
      get: {
        tags: ['Path requests'],
        summary: 'List path requests',
        description: 'Also part of `GET /api/timetables/{id}` (`path_requests`, always an array). Not audited.',
        responses: {
          200: { description: 'Requests', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/PathRequest' } } } } },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      post: {
        tags: ['Path requests'],
        summary: 'Submit a path request (crew)',
        description:
          'Files a new `pending` request. Only the active timetable takes requests, and only while `settings.requests_enabled` is not false. ' +
          '2–20 stops in running order, unique stations; origin and destination are stored as kind `stop` with 0 minutes; `locationAlias` is kept only where the station has `alias_enabled`. ' +
          'Text is trimmed: loco ≤ 60, stop note ≤ 200, siding ≤ 60, notes ≤ 500 characters. At most 50 open (pending/in_review) requests per timetable. ' +
          'Request-only change: the live sync socket sends `path-requests` with `rev`, not `timetable-updated`. Optional headers `X-LiveRun-Device` and `X-LiveRun-Clock` go to the audit log.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['crewId', 'stops'],
                properties: {
                  crewId: { type: 'string' },
                  loco: { type: 'string', example: '3001' },
                  stops: {
                    type: 'array',
                    minItems: 2,
                    maxItems: 20,
                    items: {
                      type: 'object',
                      required: ['stationId'],
                      properties: {
                        stationId: { type: 'string' },
                        locationAlias: { type: 'string', nullable: true },
                        kind: { type: 'string', enum: ['stop', 'shunt', 'work'], description: 'Required on intermediate stops' },
                        minutes: { type: 'integer', minimum: 0, maximum: 240, description: 'Required on intermediate stops' },
                        note: { type: 'string', maxLength: 200 },
                      },
                    },
                  },
                  readyAt: { type: 'string', nullable: true, example: '14:20', description: 'HH:MM, or null / absent for as soon as possible' },
                  notes: { type: 'string', maxLength: 500 },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Full updated timetable' },
          400: { description: 'Malformed request, not the active timetable, or requests turned off' },
          404: { $ref: '#/components/responses/NotFound' },
          409: { description: 'Too many open requests (50)' },
        },
      },
      delete: {
        tags: ['Path requests'],
        summary: 'Clear closed requests (Control)',
        description: 'Removes declined, withdrawn and cancelled requests, and accepted ones unless a cancel ask is open. The audit entry lists the removed ids.',
        parameters: [
          { name: 'closed', in: 'query', required: true, schema: { type: 'string', enum: ['true'] } },
        ],
        responses: {
          200: { description: 'Full updated timetable' },
          400: { description: '`closed=true` missing' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/timetables/{id}/path-requests/{reqId}/withdraw': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Timetable ID' },
        { name: 'reqId', in: 'path', required: true, schema: { type: 'string' }, description: 'Path request ID' },
      ],
      post: {
        tags: ['Path requests'],
        summary: 'Withdraw a request (crew)',
        description: 'pending or in_review → withdrawn. The audit entry notes whether Control was plotting it.',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['crewId'], properties: { crewId: { type: 'string', description: 'Acting crew; must be the requester' } } } } } },
        responses: {
          200: { description: 'Full updated timetable' },
          403: { description: 'Not the requesting crew' },
          404: { $ref: '#/components/responses/NotFound' },
          409: { $ref: '#/components/responses/WrongState' },
        },
      },
    },
    '/api/timetables/{id}/path-requests/{reqId}/acknowledge': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Timetable ID' },
        { name: 'reqId', in: 'path', required: true, schema: { type: 'string' }, description: 'Path request ID' },
      ],
      post: {
        tags: ['Path requests'],
        summary: 'Acknowledge a request (Control)',
        description: 'pending → in_review (Control is plotting it).',
        responses: {
          200: { description: 'Full updated timetable' },
          404: { $ref: '#/components/responses/NotFound' },
          409: { $ref: '#/components/responses/WrongState' },
        },
      },
    },
    '/api/timetables/{id}/path-requests/{reqId}/release': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Timetable ID' },
        { name: 'reqId', in: 'path', required: true, schema: { type: 'string' }, description: 'Path request ID' },
      ],
      post: {
        tags: ['Path requests'],
        summary: 'Return a request to the queue (Control)',
        description: 'in_review → pending. Also reopens an accepted request whose train no longer exists (e.g. undone), clearing the train link, assigned crew, note and cancel ask.',
        responses: {
          200: { description: 'Full updated timetable' },
          404: { $ref: '#/components/responses/NotFound' },
          409: { $ref: '#/components/responses/WrongState' },
        },
      },
    },
    '/api/timetables/{id}/path-requests/{reqId}/decline': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Timetable ID' },
        { name: 'reqId', in: 'path', required: true, schema: { type: 'string' }, description: 'Path request ID' },
      ],
      post: {
        tags: ['Path requests'],
        summary: 'Decline a request (Control)',
        description: 'pending or in_review → declined, with a required note to the crew (`control_note`).',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['note'], properties: { note: { type: 'string', maxLength: 300 } } } } } },
        responses: {
          200: { description: 'Full updated timetable' },
          400: { description: 'Note missing or longer than 300 characters' },
          404: { $ref: '#/components/responses/NotFound' },
          409: { $ref: '#/components/responses/WrongState' },
        },
      },
    },
    '/api/timetables/{id}/path-requests/{reqId}/accept': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Timetable ID' },
        { name: 'reqId', in: 'path', required: true, schema: { type: 'string' }, description: 'Path request ID' },
      ],
      post: {
        tags: ['Path requests'],
        summary: 'Accept a request (Control)',
        description:
          'in_review → accepted, in one mutation: creates the train (same normalisation and terminal-stop rules as `POST /trains`, plus `request_id`), ' +
          'applies `retime` (other trains moved while plotting; same shape and all-or-nothing rules as `POST /trains/retime`), and sets ' +
          '`train_id_created`, `assigned_crew_id` (the train\'s crew, or null) and `control_note`. ' +
          'The train needs a name (≤ 60), existing and unique stations, HH:MM or null times with at least 2 timed stops, and an existing crew or none. ' +
          'Notifying change: the live sync socket sends `timetable-updated` and `path-requests` (without `rev`). ' +
          'The audit entry records the train, the assigned crew if it isn\'t the requester, the note and each moved train (old → new times).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['train'],
                properties: {
                  train: {
                    type: 'object',
                    required: ['name', 'stops'],
                    properties: {
                      name: { type: 'string', maxLength: 60, example: 'PR3' },
                      color: { type: 'string', example: '#3b82f6', description: '#hex; default #3b82f6' },
                      notes: { type: 'string' },
                      trainId: { type: 'string', example: '3001', description: 'JMRI roster name' },
                      direction: { type: 'string', example: 'Up' },
                      crewId: { type: 'string', nullable: true, description: 'Empty or null = unassigned' },
                      stops: {
                        type: 'array',
                        description: 'Station order; stops without a time are dropped',
                        items: {
                          type: 'object',
                          required: ['stationId'],
                          properties: {
                            stationId: { type: 'string' },
                            arrival: { type: 'string', nullable: true, example: '14:20' },
                            departure: { type: 'string', nullable: true, example: '14:30' },
                            specialInstructions: { type: 'string' },
                            locationAlias: { type: 'string', nullable: true },
                            guardEvents: { type: 'array', items: { type: 'object' } },
                          },
                        },
                      },
                    },
                  },
                  retime: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['trainId', 'times'],
                      properties: {
                        trainId: { type: 'string' },
                        times: {
                          type: 'array',
                          items: {
                            type: 'object',
                            required: ['stationId'],
                            properties: {
                              stationId: { type: 'string' },
                              arrival: { type: 'string', nullable: true },
                              departure: { type: 'string', nullable: true },
                            },
                          },
                        },
                      },
                    },
                  },
                  note: { type: 'string', maxLength: 300, description: 'Optional note to the crew (`control_note`)' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Full updated timetable' },
          400: { description: 'Malformed train, retime or note' },
          404: { $ref: '#/components/responses/NotFound' },
          409: {
            description: 'Not in review any more (e.g. withdrawn meanwhile), or a moved train changed after it was moved (`conflicts`). Nothing is saved.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string' },
                    status: { type: 'string', example: 'withdrawn' },
                    conflicts: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/timetables/{id}/path-requests/{reqId}/cancel-ask': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Timetable ID' },
        { name: 'reqId', in: 'path', required: true, schema: { type: 'string' }, description: 'Path request ID' },
      ],
      post: {
        tags: ['Path requests'],
        summary: 'Ask to cancel an accepted path (crew)',
        description: 'Opens `cancel_ask` on an accepted request. One open ask at a time; the crew may ask again after a rejection.',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['crewId'], properties: { crewId: { type: 'string' }, reason: { type: 'string', maxLength: 300 } } } } } },
        responses: {
          200: { description: 'Full updated timetable' },
          400: { description: 'Reason longer than 300 characters' },
          403: { description: 'Not the requesting crew' },
          404: { $ref: '#/components/responses/NotFound' },
          409: { $ref: '#/components/responses/WrongState' },
        },
      },
    },
    '/api/timetables/{id}/path-requests/{reqId}/cancel-approve': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Timetable ID' },
        { name: 'reqId', in: 'path', required: true, schema: { type: 'string' }, description: 'Path request ID' },
      ],
      post: {
        tags: ['Path requests'],
        summary: 'Approve a crew\'s ask to cancel (Control)',
        description:
          'Open cancel ask → approved (optional note as `cancel_ask.control_note`), request → cancelled, and the train it created is deleted ' +
          '(if it still exists) in the same mutation. Notifying change: the live sync socket sends `timetable-updated` and `path-requests` (without `rev`). ' +
          'The audit entry records the deleted train (or null) and the note.',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { note: { type: 'string', maxLength: 300 } } } } } },
        responses: {
          200: { description: 'Full updated timetable' },
          400: { description: 'Note longer than 300 characters' },
          404: { $ref: '#/components/responses/NotFound' },
          409: { $ref: '#/components/responses/WrongState' },
        },
      },
    },
    '/api/timetables/{id}/path-requests/{reqId}/cancel-reject': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Timetable ID' },
        { name: 'reqId', in: 'path', required: true, schema: { type: 'string' }, description: 'Path request ID' },
      ],
      post: {
        tags: ['Path requests'],
        summary: 'Refuse a crew\'s ask to cancel (Control)',
        description: 'Open cancel ask → rejected, with a required note. The train stays.',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['note'], properties: { note: { type: 'string', maxLength: 300 } } } } } },
        responses: {
          200: { description: 'Full updated timetable' },
          400: { description: 'Note missing or longer than 300 characters' },
          404: { $ref: '#/components/responses/NotFound' },
          409: { $ref: '#/components/responses/WrongState' },
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
    '/api/audit': {
      get: {
        tags: ['Path requests'],
        summary: 'Path-request audit log',
        description: 'Append-only log of path-request actions (who, from which device, when, what). Newest first; reads the current and the previous rotated file. With `format=csv` it downloads `liverun-audit.csv`.',
        parameters: [
          { name: 'timetableId', in: 'query', schema: { type: 'string' } },
          { name: 'requestId', in: 'query', schema: { type: 'string' } },
          { name: 'crewId', in: 'query', schema: { type: 'string' } },
          { name: 'ip', in: 'query', schema: { type: 'string' } },
          { name: 'device', in: 'query', schema: { type: 'string' } },
          { name: 'action', in: 'query', schema: { type: 'string', enum: ['submit', 'withdraw', 'acknowledge', 'release', 'decline', 'accept', 'cancel-ask', 'cancel-approve', 'cancel-reject', 'clear'] } },
          { name: 'before', in: 'query', description: 'ISO time: only entries strictly earlier (paging).', schema: { type: 'string' } },
          { name: 'limit', in: 'query', description: 'Default 200, max 1000.', schema: { type: 'integer', minimum: 1, maximum: 1000 } },
          { name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'csv'] } },
        ],
        responses: {
          200: {
            description: 'Audit entries, newest first',
            content: {
              'application/json': { schema: { type: 'array', items: { type: 'object' } } },
              'text/csv': { schema: { type: 'string' } },
            },
          },
        },
      },
    },
  },
};

module.exports = spec;
