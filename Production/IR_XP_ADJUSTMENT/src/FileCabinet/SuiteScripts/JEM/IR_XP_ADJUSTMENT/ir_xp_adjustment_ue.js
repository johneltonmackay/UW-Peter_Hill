/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/search'],
    /**
     * @param{record} record
     * @param{search} search
     */
    (record, search) => {

        const afterSubmit = (scriptContext) => {
            if (scriptContext.type === scriptContext.UserEventType.EDIT) {
                let itemReceipt = record.load({
                    type: record.Type.ITEM_RECEIPT,
                    id: scriptContext.newRecord.id,
                    isDynamic: true
                });

                let arrRawData = [];
                let arrItem = findItem();

                let lineCount = itemReceipt.getLineCount({ sublistId: 'item' });
                for (let i = 0; i < lineCount; i++) {
                    itemReceipt.selectLine({ sublistId: 'item', line: i });
                    let itemId = itemReceipt.getCurrentSublistValue({ sublistId: 'item', fieldId: 'item' });
                    let quantity = itemReceipt.getCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity' });
                    let itemLocation = itemReceipt.getCurrentSublistValue({ sublistId: 'item', fieldId: 'location' });

                    let xpItemId = getCompoundItemDetails(itemId);

                    if (xpItemId) {
                        let xpCost = getItemCost(xpItemId);

                        arrRawData.push({
                            recordid: scriptContext.newRecord.id,
                            itemId: itemId,
                            xpItemId: xpItemId,
                            xpCost: xpCost,
                            quantity: quantity,
                            itemLocation: itemLocation
                        });
                    }
                }

                let objRecData = validateData(arrRawData, arrItem);
                log.debug('afterSubmit objRecData', objRecData);
                let fulfillmentId = null
                // let fulfillmentId = fulfillTransferOrder(itemReceipt, objRecData.validatedData, arrItem);

                if (!fulfillmentId){
                    let invAdjId = createInventoryAdjustment(objRecData);
                    if (invAdjId) {
                        record.submitFields({
                            type: scriptContext.newRecord.type,
                            id: scriptContext.newRecord.id,
                            values: {
                                custbody_related_inventory_adjustment: invAdjId,
                                memo: 'THIS IS TEST TRANSACTION - PLEASE IGNORE'
                            }
                        });
    
                        let totalLandedCost = 0;
                        objRecData.validatedData.forEach(data => {
                            totalLandedCost += (parseFloat(data.xpCost) * parseFloat(data.quantity));
                        });
    
                        let poId = itemReceipt.getValue({ fieldId: 'createdfrom' });
                        let vendorId = itemReceipt.getValue({ fieldId: 'entity' });
    
                        if (poId) {
                            applyLandedCostToPO(poId, totalLandedCost, vendorId);
                        }
                    }
                }
            }
        };


        const fulfillTransferOrder = (itemReceipt, validatedData, arrRawData) => {
            let fulfillmentId = null;
            try {

                let poId = itemReceipt.getValue({ fieldId: 'createdfrom' });
                if (!poId) {
                    log.error('fulfillTransferOrder', 'No PO found on the Item Receipt.');
                    return;
                }
        
                let poRecord = record.load({
                    type: record.Type.PURCHASE_ORDER,
                    id: poId
                });
        
                let transferOrderId = poRecord.getValue({ fieldId: 'custbody_related_transfer_order' });
                if (!transferOrderId) {
                    log.error('fulfillTransferOrder', 'No Transfer Order linked on the PO.');
                    return;
                }
        
                let fulfillment = record.transform({
                    fromType: record.Type.TRANSFER_ORDER,
                    fromId: transferOrderId,
                    toType: record.Type.ITEM_FULFILLMENT,
                    isDynamic: true
                });
        
                fulfillment.setValue({
                    fieldId: 'shipstatus', 
                    value: 'C' // Shipped
                });

                // Iterate through items and mark them as fulfilled
                var lineCount = fulfillment.getLineCount({ sublistId: 'item' });
                for (var i = 0; i < lineCount; i++) {

                    fulfillment.selectLine({ sublistId: 'item', line: i });
                    fulfillment.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'itemreceive',
                        value: true // Marks the item as received/fulfilled
                    });

                    let fulfilItemLoc = fulfillment.getCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'location',
                    });

                    let fulfilItemId = fulfillment.getCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'item',
                    });

                    if (arrRawData.length > 0) {
                        const arrFilteredLocation = arrRawData.filter(item =>
                            item.binlocation == fulfilItemLoc &&
                            item.internalId == fulfilItemId &&
                            item.location == fulfilItemLoc

                        );

                        log.debug('arrFilteredLocation', arrFilteredLocation)
                        if (arrFilteredLocation.length > 0) {
                            // Create Inventory Detail Subrecord
                            var inventoryDetail = fulfillment.getCurrentSublistSubrecord({
                                sublistId: 'item',
                                fieldId: 'inventorydetail'
                            });

                            if (inventoryDetail) {
                                // Clear existing inventory assignments
                                var invLineCount = inventoryDetail.getLineCount({ sublistId: 'inventoryassignment' });
                                for (var x = invLineCount - 1; x >= 0; x--) {
                                    inventoryDetail.removeLine({ sublistId: 'inventoryassignment', line: x });
                                }
                                
                                inventoryDetail.selectNewLine({ sublistId: 'inventoryassignment' });
                                inventoryDetail.setCurrentSublistText({
                                    sublistId: 'inventoryassignment',
                                    fieldId: 'receiptinventorynumber', 
                                    text:  arrFilteredLocation[0].inventorynumber
                                });
                                inventoryDetail.setCurrentSublistValue({
                                    sublistId: 'inventoryassignment',
                                    fieldId: 'binnumber',
                                    value: arrFilteredLocation[0].binnumber
                                });
                                inventoryDetail.setCurrentSublistValue({
                                    sublistId: 'inventoryassignment',
                                    fieldId: 'quantity', 
                                    value: validatedData[i].quantity
                                });
                                inventoryDetail.commitLine({ sublistId: 'inventoryassignment' });

                                log.debug('Inventory Detail Assigned Successfully');
                            }
                        } 
                    }

                    

                    fulfillment.commitLine({ sublistId: 'item' });
                }
        
                fulfillmentId = fulfillment.save({
                    enableSourcing: true,
                    ignoreMandatoryFields: true
                });
        
                if (fulfillmentId) {
                    record.submitFields({
                        type: 'transferorder',
                        id: transferOrderId,
                        values: {
                            custbody_related_item_fulfillment: fulfillmentId,
                            memo: 'THIS IS TEST TRANSACTION - PLEASE IGNORE'
                        }
                    });
        
                    log.debug('fulfillTransferOrder', 'Item Fulfillment created from Transfer Order: ' + fulfillmentId);
                }
        
            } catch (error) {
                log.error('fulfillTransferOrder Error', error.message);
            }
        
            return fulfillmentId;
        };
        

        const applyLandedCostToPO = (poId, landedCostAmount, vendorId) => {
            try {
                let poLandedRecord = record.create({
                    type: record.Type.PURCHASE_ORDER,
                    isDynamic: true
                });
        
                poLandedRecord.setValue({ fieldId: 'customform', value: 154 }); // FREIGHT Purchase Order 2016
                poLandedRecord.setValue({ fieldId: 'entity', value: vendorId });
                poLandedRecord.setValue({ fieldId: 'custbody56', value: vendorId });
                poLandedRecord.setValue({ fieldId: 'memo', value: 'THIS IS TEST TRANSACTION - PLEASE IGNORE' });
                poLandedRecord.setValue({ fieldId: 'approvalstatus', value: 1 }); // Pending Approval
                poLandedRecord.setValue({ fieldId: 'custbody_pri_lc_product_purchaseorders', value: poId });
        
                poLandedRecord.selectNewLine({ sublistId: 'expense' }); 
                poLandedRecord.setCurrentSublistValue({
                    sublistId: 'expense',
                    fieldId: 'account', 
                    value: 597 // 12154 Inventory Prepayments & Accruals : Inbound Freight to be Billed
                });
                poLandedRecord.setCurrentSublistValue({
                    sublistId: 'expense',
                    fieldId: 'amount', 
                    value: landedCostAmount
                });
                poLandedRecord.commitLine({ sublistId: 'expense' });

                let updatedPoId = poLandedRecord.save({
                    enableSourcing: true,
                    ignoreMandatoryFields: true
                });
        
                log.debug('applyLandedCostToPO', 'Landed cost applied to PO: ' + updatedPoId);
        
            } catch (error) {
                log.error('applyLandedCostToPO Error', error.message);
            }
        };        

        const validateData = (arrRawData, arrItem) => {
            let validatedData = [];
            let skippedLines = [];

            arrRawData.forEach(data => {
                let arrFilteredItem = arrItem.filter(item =>
                    item.internalId == data.xpItemId
                );
                log.debug('validateData arrFilteredItem', arrFilteredItem)

                if (arrFilteredItem.length > 0) {
                    const arrFilteredLocation = arrFilteredItem.filter(item =>
                        item.location == data.itemLocation
                    );
                    log.debug('validateData arrFilteredLocation', arrFilteredLocation)
                    if (arrFilteredLocation.length > 0) {
                        if (arrFilteredLocation[0].islotitem) {
                            if (parseFloat(arrFilteredLocation[0].quantityavailable) >= parseFloat(data.quantity)) {
                                data.lotnumber = arrFilteredLocation[0].inventorynumber;
                                data.binnumber = arrFilteredLocation[0].binnumber;
                                data.binnumberloc = arrFilteredLocation[0].binlocation;
                                data.vendorlocation = arrFilteredLocation[0].vendorlocation
                                data.xpItemId_location = arrFilteredLocation[0].location;
                                data.quantityavailable = arrFilteredLocation[0].quantityavailable;
                                data.isLotNumbered = true;
                                validatedData.push(data);
                            } else {
                                skippedLines.push({
                                    status: "SKIPPED",
                                    remarks: `Not Enough Quantity Available for ${data.itemId}`,
                                    data: data
                                });
                            }
                        } else {
                            data.isLotNumbered = false;
                            validatedData.push(data);
                        }
                    } else {
                        skippedLines.push({
                            status: "SKIPPED",
                            remarks: `${data.itemLocation} for Location Not Found for Item ${data.itemId}`,
                            data: data
                        });
                    }
                }
            });

            return {
                validatedData: validatedData,
                skippedLines: skippedLines
            };
        };

        const findItem = () => {
            let arrLotNumber = [];
            try {
                let objSearch = search.create({
                    type: 'item',
                    filters: ['name', 'startswith', 'XP'],
                    columns: [
                        search.createColumn({ name: 'internalid' }),
                        search.createColumn({ name: 'itemid' }),
                        search.createColumn({ name: 'type' }),
                        search.createColumn({ name: 'islotitem' }),
                        search.createColumn({ name: 'inventorynumber', join: 'inventorynumber' }),
                        search.createColumn({ name: 'location', join: 'inventorynumber' }),
                        search.createColumn({ name: 'binnumber', join: 'inventorynumberbinonhand' }),
                        search.createColumn({ name: 'location', join: 'inventorynumberbinonhand' }),
                        search.createColumn({ name: 'custentity_compound_location_mapping', join: 'preferredvendor' }),
                        search.createColumn({ name: 'quantityavailable', join: 'inventorynumber', sort: search.Sort.DESC })
                    ]
                });

                let searchResultCount = objSearch.runPaged().count;
                if (searchResultCount !== 0) {
                    let pagedData = objSearch.runPaged({ pageSize: 1000 });
                    for (let i = 0; i < pagedData.pageRanges.length; i++) {
                        let currentPage = pagedData.fetch(i);
                        let pageData = currentPage.data;
                        if (pageData.length > 0) {
                            for (let pageResultIndex = 0; pageResultIndex < pageData.length; pageResultIndex++) {
                                arrLotNumber.push({
                                    internalId: pageData[pageResultIndex].getValue({ name: 'internalid' }),
                                    location: pageData[pageResultIndex].getValue({ name: 'location', join: 'inventorynumber' }),
                                    item: pageData[pageResultIndex].getValue({ name: 'itemid' }),
                                    type: pageData[pageResultIndex].getValue({ name: 'type' }),
                                    islotitem: pageData[pageResultIndex].getValue({ name: 'islotitem' }),
                                    inventorynumber: pageData[pageResultIndex].getValue({ name: 'inventorynumber', join: 'inventorynumber' }),
                                    binnumber: pageData[pageResultIndex].getValue({ name: 'binnumber', join: 'inventorynumberbinonhand' }),
                                    binlocation: pageData[pageResultIndex].getValue({ name: 'location', join: 'inventorynumberbinonhand' }),
                                    vendorlocation: pageData[pageResultIndex].getValue({ name: 'custentity_compound_location_mapping', join: 'preferredvendor' }),
                                    quantityavailable: pageData[pageResultIndex].getValue({ name: 'quantityavailable', join: 'inventorynumber' })
                                });
                            }
                        }
                    }
                }
            } catch (err) {
                log.error('findItem', err.message);
            }
            return arrLotNumber;
        };

        const getCompoundItemDetails = (itemId) => {
            let searchResult = search.lookupFields({
                type: 'item',
                id: itemId,
                columns: ['custitem_compound_item_mapping'] // Custom field that links to the component item.
            });
            return (searchResult.custitem_compound_item_mapping &&
                    searchResult.custitem_compound_item_mapping.length > 0)
                ? searchResult.custitem_compound_item_mapping[0].value
                : null;
        };

        const getItemCost = (itemId) => {
            let searchResult = search.lookupFields({
                type: 'inventoryitem',
                id: itemId,
                columns: ['averagecost']
            });
            return searchResult.averagecost || 0;
        };

        const createInventoryAdjustment = (objRecData) => {
            let invAdjId = null;
            let arrItemToProcess = objRecData.validatedData;
            log.debug('createInventoryAdjustment arrItemToProcess', arrItemToProcess);

            try {
                let inventoryAdj = record.create({ type: record.Type.INVENTORY_ADJUSTMENT, isDynamic: true });
                inventoryAdj.setValue({ fieldId: 'account', value: 597 });
                inventoryAdj.setValue({ fieldId: 'memo', value: 'THIS IS TEST TRANSACTION - PLEASE IGNORE' });

                arrItemToProcess.forEach(data => {
                    inventoryAdj.selectNewLine({ sublistId: 'inventory' });
                    inventoryAdj.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'item', value: data.xpItemId });
                    inventoryAdj.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'location', value: data.xpItemId_location });
                    inventoryAdj.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'adjustqtyby', value: data.quantity });

                    // Handle Lot Numbered Items
                    if (data.isLotNumbered) {
                        let inventoryDetail = inventoryAdj.getCurrentSublistSubrecord({
                            sublistId: 'inventory',
                            fieldId: 'inventorydetail'
                        });
        
                        inventoryDetail.selectNewLine({ sublistId: 'inventoryassignment' });
                        inventoryDetail.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'receiptinventorynumber', value: data.lotnumber });
                        inventoryDetail.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'binnumber', value: data.binnumber });
                        inventoryDetail.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'quantity', value: data.quantity });
                        inventoryDetail.commitLine({ sublistId: 'inventoryassignment' });
                    }
                    
                    inventoryAdj.commitLine({ sublistId: 'inventory' });
                });

                invAdjId = inventoryAdj.save({
                    enableSourcing: true,
                    ignoreMandatoryFields: true
                });
            } catch (error) {
                log.error('createInventoryAdjustment', error.message);
            }

            return invAdjId;
        };

        return { afterSubmit };

    });
