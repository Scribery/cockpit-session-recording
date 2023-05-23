/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

import React from "react";
import {
    Breadcrumb, BreadcrumbItem,
    Button,
    Flex,
    Form,
    FormGroup,
    FormSelect,
    FormSelectOption,
    TextInput,
    ActionGroup,
    Spinner,
    Card,
    CardTitle,
    CardBody,
    Checkbox,
    Bullseye,
    EmptyState,
    EmptyStateIcon,
    EmptyStateBody,
    EmptyStateVariant,
    Page, PageSection, EmptyStateHeader,
} from "@patternfly/react-core";
import { ExclamationCircleIcon } from "@patternfly/react-icons";
import { global_danger_color_200 } from "@patternfly/react-tokens";
import cockpit from 'cockpit';

const json = require('comment-json');
const ini = require('ini');
const _ = cockpit.gettext;

class GeneralConfig extends React.Component {
    constructor(props) {
        super(props);
        this.handleSubmit = this.handleSubmit.bind(this);
        this.handleInputChange = this.handleInputChange.bind(this);
        this.setConfig = this.setConfig.bind(this);
        this.fileReadFailed = this.fileReadFailed.bind(this);
        this.readConfig = this.readConfig.bind(this);
        this.file = null;
        this.config = null;
        this.state = {
            config_loaded: false,
            file_error: false,
            submitting: false,
            shell: "",
            notice: "",
            latency: "",
            payload: "",
            log_input: false,
            log_output: true,
            log_window: true,
            limit_rate: "",
            limit_burst: "",
            limit_action: "",
            file_path: "",
            syslog_facility: "",
            syslog_priority: "",
            journal_augment: "",
            journal_priority: "",
            writer: "",
        };
    }

    handleSubmit(event) {
        this.setState({ submitting: true });
        const config = {
            shell:  this.state.shell,
            notice:  this.state.notice,
            latency:  parseInt(this.state.latency),
            payload:  parseInt(this.state.payload),
            log:  {
                input:  this.state.log_input,
                output:  this.state.log_output,
                window:  this.state.log_window,
            },
            limit:  {
                rate:  parseInt(this.state.limit_rate),
                burst:  parseInt(this.state.limit_burst),
                action:  this.state.limit_action,
            },
            file:  {
                path:  this.state.file_path,
            },
            syslog:  {
                facility:  this.state.syslog_facility,
                priority:  this.state.syslog_priority,
            },
            journal:  {
                priority:  this.state.journal_priority,
                augment:  this.state.journal_augment
            },
            writer:  this.state.writer
        };
        this.file.replace(config).done(() => {
            this.setState({ submitting: false });
        })
                .fail((error) => {
                    console.log(error);
                });
        event.preventDefault();
    }

    setConfig(data) {
        delete data.configuration;
        delete data.args;
        const flattenObject = function(ob) {
            const toReturn = {};

            for (const i in ob) {
                if (!Object.prototype.hasOwnProperty.call(ob, i)) continue;

                if ((typeof ob[i]) == 'object') {
                    const flatObject = flattenObject(ob[i]);
                    for (const x in flatObject) {
                        if (!Object.prototype.hasOwnProperty.call(flatObject, x)) continue;

                        toReturn[i + '_' + x] = flatObject[x];
                    }
                } else {
                    toReturn[i] = ob[i];
                }
            }
            return toReturn;
        };
        const state = flattenObject(data);
        state.config_loaded = true;
        this.setState(state);
    }

    getConfig() {
        const proc = cockpit.spawn(["tlog-rec-session", "--configuration"]);

        proc.stream((data) => {
            this.setConfig(json.parse(data, null, true));
            proc.close();
        });

        proc.fail((fail) => {
            console.log(fail);
            this.readConfig();
        });
    }

    readConfig() {
        const parseFunc = function(data) {
            return json.parse(data, null, true);
        };

        const stringifyFunc = function(data) {
            return json.stringify(data, null, true);
        };
        // needed for cockpit.file usage
        const syntax_object = {
            parse: parseFunc,
            stringify: stringifyFunc,
        };

        this.file = cockpit.file("/etc/tlog/tlog-rec-session.conf", {
            syntax: syntax_object,
            superuser: true,
        });
    }

    fileReadFailed(reason) {
        console.log(reason);
        this.setState({ file_error: reason });
    }

    componentDidMount() {
        this.getConfig();
        this.readConfig();
    }

    handleInputChange(name, value) {
        const state = {};
        state[name] = value;
        this.setState(state);
    }

    render() {
        const form =
            (this.state.config_loaded === false && this.state.file_error === false)
                ? <Spinner />
                : (this.state.config_loaded === true && this.state.file_error === false)
                    ? (
                        <Form isHorizontal>
                            <FormGroup label={_("Shell")}>
                                <TextInput
                                    id="shell"
                                    value={this.state.shell}
                                    onChange={(_event, value) => this.handleInputChange("shell", value)}
                                />
                            </FormGroup>
                            <FormGroup label={_("Notice")}>
                                <TextInput
                                    id="notice"
                                    value={this.state.notice}
                                    onChange={(_event, value) => this.handleInputChange("notice", value)}
                                />
                            </FormGroup>
                            <FormGroup label={_("Latency")}>
                                <TextInput
                                    id="latency"
                                    type="number"
                                    step="1"
                                    value={this.state.latency}
                                    onChange={(_event, value) => this.handleInputChange("latency", value)}
                                />
                            </FormGroup>
                            <FormGroup label={_("Payload Size, bytes")}>
                                <TextInput
                                    id="payload"
                                    type="number"
                                    step="1"
                                    value={this.state.payload}
                                    onChange={(_event, value) => this.handleInputChange("payload", value)}
                                />
                            </FormGroup>
                            <FormGroup label={_("Logging")}>
                                <Checkbox
                                    id="log_input"
                                    isChecked={this.state.log_input}
                                    onChange={(_event, log_input) => this.setState({ log_input })}
                                    label={_("User's Input")}
                                />
                                <Checkbox
                                    id="log_output"
                                    isChecked={this.state.log_output}
                                    onChange={(_event, log_output) => this.setState({ log_output })}
                                    label={_("User's Output")}
                                />
                                <Checkbox
                                    id="log_window"
                                    isChecked={this.state.log_window}
                                    onChange={(_event, log_window) => this.setState({ log_window })}
                                    label={_("Window Resize")}
                                />
                            </FormGroup>
                            <FormGroup label={_("Limit Rate, bytes/sec")}>
                                <TextInput
                                    id="limit_rate"
                                    type="number"
                                    step="1"
                                    value={this.state.limit_rate}
                                    onChange={(_event, value) => this.handleInputChange("limit_rate", value)}
                                />
                            </FormGroup>
                            <FormGroup label={_("Burst, bytes")}>
                                <TextInput
                                    id="limit_burst"
                                    type="number"
                                    step="1"
                                    value={this.state.limit_burst}
                                    onChange={(_event, value) => this.handleInputChange("limit_burst", value)}
                                />
                            </FormGroup>
                            <FormGroup label={_("Logging Limit Action")}>
                                <FormSelect
                                    id="limit_action"
                                    value={this.state.limit_action}
                                    onChange={(_event, value) => this.handleInputChange("limit_action", value)}
                                >
                                    {[
                                        { value: "", label: "" },
                                        { value: "pass", label: _("Pass") },
                                        { value: "delay", label: _("Delay") },
                                        { value: "drop", label: _("Drop") }
                                    ].map((option, index) =>
                                        <FormSelectOption
                                        key={index}
                                        value={option.value}
                                        label={option.label}
                                        />
                                    )}
                                </FormSelect>
                            </FormGroup>
                            <FormGroup label={_("File Path")}>
                                <TextInput
                                    id="file_path"
                                    value={this.state.file_path}
                                    onChange={(_event, value) => this.handleInputChange("file_path", value)}
                                />
                            </FormGroup>
                            <FormGroup label={_("Syslog Facility")}>
                                <TextInput
                                    id="syslog_facility"
                                    value={this.state.syslog_facility}
                                    onChange={(_event, value) => this.handleInputChange("syslog_facility", value)}

                                />
                            </FormGroup>
                            <FormGroup label={_("Syslog Priority")}>
                                <FormSelect
                                    id="syslog_priority"
                                    value={this.state.syslog_priority}
                                    onChange={(_event, value) => this.handleInputChange("syslog_priority", value)}
                                >
                                    {[
                                        { value: "", label: "" },
                                        { value: "info", label: _("Info") },
                                    ].map((option, index) =>
                                        <FormSelectOption
                                        key={index}
                                        value={option.value}
                                        label={option.label}
                                        />
                                    )}
                                </FormSelect>
                            </FormGroup>
                            <FormGroup label={_("Journal Priority")}>
                                <FormSelect
                                    id="journal_priority"
                                    value={this.state.journal_priority}
                                    onChange={(_event, value) => this.handleInputChange("journal_priority", value)}

                                >
                                    {[
                                        { value: "", label: "" },
                                        { value: "info", label: _("Info") },
                                    ].map((option, index) =>
                                        <FormSelectOption
                                        key={index}
                                        value={option.value}
                                        label={option.label}
                                        />
                                    )}
                                </FormSelect>
                            </FormGroup>
                            <FormGroup>
                                <Checkbox
                                    id="journal_augment"
                                    isChecked={this.state.journal_augment}
                                    onChange={(_event, journal_augment) => this.setState({ journal_augment })}
                                    label={_("Augment")}
                                />
                            </FormGroup>
                            <FormGroup label={_("Writer")}>
                                <FormSelect
                                    id="writer"
                                    value={this.state.writer}
                                    onChange={(_event, value) => this.handleInputChange("writer", value)}
                                >
                                    {[
                                        { value: "", label: "" },
                                        { value: "journal", label: _("Journal") },
                                        { value: "syslog", label: _("Syslog") },
                                        { value: "file", label: _("File") },
                                    ].map((option, index) =>
                                        <FormSelectOption
                                        key={index}
                                        value={option.value}
                                        label={option.label}
                                        />
                                    )}
                                </FormSelect>
                            </FormGroup>
                            <ActionGroup>
                                <Button
                                    id="btn-save-tlog-conf"
                                    variant="primary"
                                    onClick={this.handleSubmit}
                                >
                                    {_("Save")}
                                </Button>
                                {this.state.submitting === true && <Spinner size="lg" />}
                            </ActionGroup>
                        </Form>
                    )
                    : (
                        <Bullseye>
                            <EmptyState variant={EmptyStateVariant.sm}>
                                <EmptyStateHeader
                                titleText={<>{_("There is no configuration file of tlog present in your system.")}</>}
                                icon={
                                    <EmptyStateIcon
                                icon={ExclamationCircleIcon}
                                color={global_danger_color_200.value}
                                    />
                                } headingLevel="h4"
                                />
                                <EmptyStateHeader titleText={<>{_("Please, check the /etc/tlog/tlog-rec-session.conf or if tlog is installed.")}</>} headingLevel="h4" />
                                <EmptyStateBody>
                                    {this.state.file_error}
                                </EmptyStateBody>
                            </EmptyState>
                        </Bullseye>
                    );

        return (
            <Card>
                <CardTitle>General Config</CardTitle>
                <CardBody>{form}</CardBody>
            </Card>
        );
    }
}

class SssdConfig extends React.Component {
    constructor(props) {
        super(props);
        this.handleSubmit = this.handleSubmit.bind(this);
        this.handleInputChange = this.handleInputChange.bind(this);
        this.confSave = this.confSave.bind(this);
        this.restartSSSD = this.restartSSSD.bind(this);
        this.file = null;
        this.state = {
            scope: "",
            users: "",
            exclude_users: "",
            exclude_groups: "",
            groups: "",
            submitting: false,
        };
    }

    customIniUnparser(obj) {
        return ini.stringify(obj, { platform: 'linux' }).replace('domainnssfiles', 'domain/nssfiles');
    }

    restartSSSD() {
        const sssd_cmd = ["systemctl", "restart", "sssd"];
        cockpit.spawn(sssd_cmd, { superuser: "require" });
        this.setState({ submitting: false });
    }

    confSave(obj) {
        const chmod_cmd = ["chmod", "600", "/etc/sssd/conf.d/sssd-session-recording.conf"];
        /* Update nsswitch, this will fail on RHEL8/F34 and lower as 'with-files-domain' feature is not added there */
        const authselect_cmd = ["authselect", "select", "sssd", "with-files-domain", "--force"];
        this.setState({ submitting: true });
        this.file.replace(obj)
                .then(tag => {
                    cockpit.spawn(chmod_cmd, { superuser: "require" })
                            .then(() => {
                                cockpit.spawn(authselect_cmd, { superuser: "require" })
                                        .then(this.restartSSSD)
                                        .catch(this.restartSSSD);
                            });
                })
                .catch(error => {
                    console.error(error);
                });
    }

    componentDidMount() {
        const syntax_object = {
            parse:     ini.parse,
            stringify: this.customIniUnparser,
        };

        this.file = cockpit.file("/etc/sssd/conf.d/sssd-session-recording.conf", {
            syntax: syntax_object,
            superuser: true,
        });

        const conf_syntax_object = {
            parse:     ini.parse,
        };

        this.sssdconf = cockpit.file("/etc/sssd/sssd.conf", {
            syntax: conf_syntax_object,
            superuser: true,
        });

        const promise = this.file.read();
        const sssdconfpromise = this.sssdconf.read();

        promise.fail(function(error) {
            console.log(error);
        });

        /* It is not an error when the file does not exist, then() callback will
         * be called with a null value for content and tag is "-" */
        sssdconfpromise
                .then((content, tag) => {
                    if (content !== null) {
                        this.existingServices = content.sssd.services;
                        this.existingDomains = content.sssd.domains;
                    }
                })
                .catch(error => {
                    console.log("Error: " + error);
                });
    }

    handleSubmit(e) {
        const obj = {};
        /* SSSD section */
        obj.sssd = {};
        /* Avoid overwriting services and domain sections of existing sssd.conf
         * Copy the services section used in sssd.conf, and append 'proxy' to
         * existing domain section */
        if (this.existingServices) {
            obj.sssd.services = this.existingServices;
        } else {
            obj.sssd.services = "nss, pam";
        }

        if (this.existingDomains) {
            obj.sssd.domains = this.existingDomains + ", nssfiles";
        } else {
            obj.sssd.domains = "nssfiles";
        }
        /* Proxy provider */
        obj.domainnssfiles = {}; /* Unparser converts this into domain/nssfiles */
        obj.domainnssfiles.id_provider = "proxy";
        obj.domainnssfiles.proxy_lib_name = "files";
        obj.domainnssfiles.proxy_pam_target = "sssd-shadowutils";
        /* Session recording */
        obj.session_recording = {};
        obj.session_recording.scope = this.state.scope;
        switch (this.state.scope) {
        case "all":
            obj.session_recording.exclude_users = this.state.exclude_users;
            obj.session_recording.exclude_groups = this.state.exclude_groups;
            break;
        case "none":
            break;
        case "some":
            obj.session_recording.users = this.state.users;
            obj.session_recording.groups = this.state.groups;
            break;
        default:
            break;
        }
        this.confSave(obj);
        e.preventDefault();
    }

    handleInputChange(name, value) {
        const state = {};
        state[name] = value;
        this.setState(state);
    }

    render() {
        const form = (
            <Form isHorizontal>
                <FormGroup label="Scope">
                    <FormSelect
                        id="scope"
                        value={this.state.scope}
                        onChange={(_event, value) => this.handleInputChange("scope", value)}
                    >
                        {[
                            { value: "none", label: _("None") },
                            { value: "some", label: _("Some") },
                            { value: "all", label: _("All") }
                        ].map((option, index) =>
                            <FormSelectOption
                                key={index}
                                value={option.value}
                                label={option.label}
                            />
                        )}
                    </FormSelect>
                </FormGroup>
                {this.state.scope === "some" &&
                <>
                    <FormGroup label={_("Users")}>
                        <TextInput
                            id="users"
                            value={this.state.users}
                            onChange={(_event, value) => this.handleInputChange("users", value)}
                        />
                    </FormGroup>
                    <FormGroup label={_("Groups")}>
                        <TextInput
                            id="groups"
                            value={this.state.groups}
                            onChange={(_event, value) => this.handleInputChange("groups", value)}
                        />
                    </FormGroup>
                </>}
                {this.state.scope === "all" &&
                <>
                    <FormGroup label={_("Exclude Users")}>
                        <TextInput
                            id="exclude_users"
                            value={this.state.exclude_users}
                            onChange={(_event, value) => this.handleInputChange("exclude_users", value)}
                        />
                    </FormGroup>
                    <FormGroup label={_("Exclude Groups")}>
                        <TextInput
                            id="exclude_groups"
                            value={this.state.exclude_groups}
                            onChange={(_event, value) => this.handleInputChange("exclude_groups", value)}
                        />
                    </FormGroup>
                </>}
                <ActionGroup>
                    <Button
                        id="btn-save-sssd-conf"
                        variant="primary"
                        onClick={this.handleSubmit}
                    >
                        {_("Save")}
                    </Button>
                    {this.state.submitting === true && <Spinner size="lg" />}
                </ActionGroup>
            </Form>
        );

        return (
            <Card>
                <CardTitle>SSSD Config</CardTitle>
                <CardBody>{form}</CardBody>
            </Card>
        );
    }
}

export function Config () {
    const goBack = () => {
        cockpit.location.go("/");
    };

    return (
        <Page
groupProps={{ sticky: 'top' }}
              isBreadcrumbGrouped
              breadcrumb={
                  <Breadcrumb className='machines-listing-breadcrumb'>
                      <BreadcrumbItem to='#' onClick={goBack}>
                          {_("Session Recording")}
                      </BreadcrumbItem>
                      <BreadcrumbItem isActive>
                          {_("Settings")}
                      </BreadcrumbItem>
                  </Breadcrumb>
              }
        >
            <PageSection>
                <Flex className="config-container">
                    <GeneralConfig />
                    <SssdConfig />
                </Flex>
            </PageSection>
        </Page>
    );
}
