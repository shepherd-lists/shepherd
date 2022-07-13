process.env['NODE_ENV'] = 'test'
import {  } from 'mocha'
import { expect } from 'chai'
import { byteRanges } from '../src/http-api/byteRanges'
import { DataItem } from 'arbundles'
import axios from 'axios'


describe('byte-ranges tests', ()=>{

	it('should return the correct byte range for an ans104 dataItem, and test reconstructed dataItem', async()=> {
		const wantedId = 'I210xM6oaK2G2AnHH1tN49E-Nu_WPWosWHFSLz2UbQ0'
		const bundleId = 'Yn9PXQvhb1stfjVxJwY4Ei4aIrqUbYVVkwlQiah_8FQ'
		const wantedStart = 87742364821010n
		const wantedEnd = 87742364822091n
		const bundleStart = 87742364823170n + 1n - 3468n

		const { byteStart, byteEnd } = await byteRanges(wantedId, bundleId)
		
		expect(byteStart, 'byteStart should equal value').eq(wantedStart)
		expect(byteEnd, 'byteEns should equal value').eq(wantedEnd)
		
		//reconstuct dataItem from binary
		const { data } = await axios.get('https://arweave.net/' + bundleId, { responseType: 'arraybuffer'})
		const splicedData = (data as Buffer).subarray(
			Number(byteStart - bundleStart), 
			Number(byteEnd - bundleStart),
		)

		const dataItem = new DataItem(splicedData)
		expect(dataItem.id).eq(wantedId)
		expect(await dataItem.isValid(), 'recontructed dataItem should be valid').true

	}).timeout(0)


})
